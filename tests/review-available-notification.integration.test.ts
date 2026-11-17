import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { createReviewAvailableNotifications } from "../src/services/review-available-notification-service.js";
import { createReview } from "../src/services/review-service.js";
import type { TransactionRunner } from "../src/types/db.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 각 테스트에서 사용할 독립적인 팟오너, 팟트너 및 돌봄 요청 생성
async function createTestRequest(
  options: {
    endOffsetDays?: number;
    status?: "MATCHED" | "OPEN" | "EXPIRED";
    confirmed?: boolean;
  } = {},
) {
  const { endOffsetDays = -1, status = "MATCHED", confirmed = true } = options;

  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `review-available-owner-${uniqueId}@example.com`,
      nickname: `review-available-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `review-available-sitter-${uniqueId}@example.com`,
      nickname: `review-available-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
      sitterProfile: {
        create: {
          gender: "FEMALE",
          shortIntroduction: "테스트용 팟트너",
        },
      },
    },
  });

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: dateOffset(endOffsetDays - 3),
      endDate: dateOffset(endOffsetDays),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status,
    },
  });

  const quote = await prisma.quote.create({
    data: {
      careRequestId: careRequest.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 50000,
      comment: "테스트 견적 코멘트입니다.",
    },
  });

  if (confirmed) {
    await prisma.careRequest.update({
      where: { id: careRequest.id },
      data: { confirmedQuoteId: quote.id },
    });
  }

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    sitterNickname: sitter.nickname,
    careRequestId: careRequest.id,
  };
}

// 실제 트랜잭션 내부에서 알림 저장 시점에만 오류 발생
function createNotificationFailureRunner(notificationError: Error): TransactionRunner {
  return (callback) =>
    prisma.$transaction(async (tx) => {
      const failureTx = new Proxy(tx, {
        get(target, property) {
          if (property === "notification") {
            return new Proxy(target.notification, {
              get(model, method) {
                if (method === "createManyAndReturn") {
                  return async () => {
                    throw notificationError;
                  };
                }

                return Reflect.get(model, method);
              },
            });
          }

          return Reflect.get(target, property);
        },
      });

      return callback(failureTx);
    });
}

async function findReviewAvailableNotifications(careRequestId: bigint) {
  return prisma.notification.findMany({
    where: {
      careRequestId,
      type: "REVIEW_AVAILABLE",
    },
  });
}

describe("리뷰 작성 가능 알림 생성", () => {
  describe("생성 조건", () => {
    // 종료일 다음 날부터 팟오너에게 확정 팟트너의 닉네임을 포함한 알림을 생성하는지 확인
    it("MATCHED 요청의 종료일이 지나면 팟오너에게 REVIEW_AVAILABLE 알림을 생성한다", async () => {
      const { ownerId, sitterNickname, careRequestId } = await createTestRequest();

      const result = await createReviewAvailableNotifications();
      const notifications = await findReviewAvailableNotifications(careRequestId);

      assert.equal(notifications.length, 1);

      const notification = notifications[0];

      assert.equal(notification.recipientId, ownerId);
      assert.equal(notification.careRequestId, careRequestId);
      assert.equal(notification.type, "REVIEW_AVAILABLE");
      assert.equal(notification.message, `${sitterNickname} 팟트너에게 리뷰를 작성해 주세요!`);
      assert.equal(notification.readAt, null);
      assert.ok(notification.createdAt instanceof Date);

      assert.ok(
        result.notifications.some(
          (created) =>
            created.id === notification.id &&
            created.recipientId === ownerId &&
            created.careRequestId === careRequestId,
        ),
      );
      assert.equal(result.reviewAvailableNotificationCount, result.notifications.length);
    });

    // 종료일 당일과 종료일 이전에는 알림을 생성하지 않는지 확인
    it("종료일이 지나지 않은 요청은 알림 생성 대상에서 제외한다", async () => {
      const todayRequest = await createTestRequest({
        endOffsetDays: 0,
      });
      const futureRequest = await createTestRequest({
        endOffsetDays: 1,
      });

      await createReviewAvailableNotifications();

      assert.equal((await findReviewAvailableNotifications(todayRequest.careRequestId)).length, 0);
      assert.equal((await findReviewAvailableNotifications(futureRequest.careRequestId)).length, 0);
    });

    // MATCHED 상태가 아니거나 확정 견적이 없는 요청은 제외하는지 확인
    it("MATCHED 상태 또는 확정 견적 조건을 충족하지 않으면 생성하지 않는다", async () => {
      const openRequest = await createTestRequest({
        status: "OPEN",
        confirmed: false,
      });
      const expiredRequest = await createTestRequest({
        status: "EXPIRED",
        confirmed: false,
      });
      const unconfirmedRequest = await createTestRequest({
        confirmed: false,
      });

      await createReviewAvailableNotifications();

      for (const request of [openRequest, expiredRequest, unconfirmedRequest]) {
        assert.equal((await findReviewAvailableNotifications(request.careRequestId)).length, 0);
      }
    });

    // 이미 작성한 리뷰와 소프트 삭제된 리뷰가 모두 생성 제외 조건인지 확인
    it("작성된 리뷰 또는 삭제 이력이 존재하면 알림을 생성하지 않는다", async () => {
      const reviewedRequest = await createTestRequest();
      const deletedReviewRequest = await createTestRequest();

      const reviewed = await prisma.review.create({
        data: {
          careRequestId: reviewedRequest.careRequestId,
          ownerId: reviewedRequest.ownerId,
          sitterId: reviewedRequest.sitterId,
          rating: 5,
          content: "정말 친절하셨어요.",
        },
      });

      const deletedReview = await prisma.review.create({
        data: {
          careRequestId: deletedReviewRequest.careRequestId,
          ownerId: deletedReviewRequest.ownerId,
          sitterId: deletedReviewRequest.sitterId,
          rating: 5,
          content: "돌봄 서비스가 만족스러웠습니다.",
          deletedAt: new Date(),
        },
      });

      await createReviewAvailableNotifications();

      assert.equal(
        (await findReviewAvailableNotifications(reviewedRequest.careRequestId)).length,
        0,
      );
      assert.equal(
        (await findReviewAvailableNotifications(deletedReviewRequest.careRequestId)).length,
        0,
      );

      assert.equal(
        await prisma.review.count({
          where: { id: { in: [reviewed.id, deletedReview.id] } },
        }),
        2,
      );
    });

    // 최초 발생 예정일이 지난 요청도 리뷰 미작성 상태라면 알림을 생성하는지 확인
    it("종료일 다음 날이 지난 누락 요청도 리뷰 미작성 상태라면 알림을 생성한다", async () => {
      const { careRequestId } = await createTestRequest({
        endOffsetDays: -7,
      });

      await createReviewAvailableNotifications();

      assert.equal((await findReviewAvailableNotifications(careRequestId)).length, 1);
    });

    // 이미 알림이 존재하는 요청은 반복 실행에서 다시 생성되지 않는지 확인
    it("반복 실행해도 기존 REVIEW_AVAILABLE 알림을 중복 생성하지 않는다", async () => {
      const { careRequestId } = await createTestRequest();

      const firstResult = await createReviewAvailableNotifications();
      const firstNotifications = await findReviewAvailableNotifications(careRequestId);

      assert.equal(firstNotifications.length, 1);
      assert.ok(
        firstResult.notifications.some(
          (notification) => notification.id === firstNotifications[0].id,
        ),
      );

      const secondResult = await createReviewAvailableNotifications();
      const secondNotifications = await findReviewAvailableNotifications(careRequestId);

      assert.equal(secondNotifications.length, 1);
      assert.equal(secondNotifications[0].id, firstNotifications[0].id);
      assert.equal(
        secondResult.notifications.some(
          (notification) => notification.careRequestId === careRequestId,
        ),
        false,
      );
    });

    // 사용자가 이미 읽은 알림도 기존 알림으로 판단하는지 확인
    it("기존 알림의 읽음 여부와 관계없이 신규 생성 대상에서 제외한다", async () => {
      const unreadRequest = await createTestRequest();
      const readRequest = await createTestRequest();

      const unreadNotification = await prisma.notification.create({
        data: {
          recipientId: unreadRequest.ownerId,
          careRequestId: unreadRequest.careRequestId,
          type: "REVIEW_AVAILABLE",
          message: "기존 미확인 알림",
        },
      });

      const readAt = new Date();

      const readNotification = await prisma.notification.create({
        data: {
          recipientId: readRequest.ownerId,
          careRequestId: readRequest.careRequestId,
          type: "REVIEW_AVAILABLE",
          message: "기존 확인 알림",
          readAt,
        },
      });

      const result = await createReviewAvailableNotifications();

      assert.equal(
        result.notifications.some(
          (notification) =>
            notification.careRequestId === unreadRequest.careRequestId ||
            notification.careRequestId === readRequest.careRequestId,
        ),
        false,
      );

      const unreadNotifications = await findReviewAvailableNotifications(
        unreadRequest.careRequestId,
      );
      const readNotifications = await findReviewAvailableNotifications(readRequest.careRequestId);

      assert.equal(unreadNotifications.length, 1);
      assert.equal(unreadNotifications[0].id, unreadNotification.id);
      assert.equal(unreadNotifications[0].readAt, null);

      assert.equal(readNotifications.length, 1);
      assert.equal(readNotifications[0].id, readNotification.id);
      assert.deepEqual(readNotifications[0].readAt, readAt);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 두 실행이 동일한 돌봄 요청을 처리해도 알림은 한 건만 저장되는지 확인
    it("동시에 두 번 실행해도 동일한 요청의 알림은 한 건만 생성한다", async () => {
      const { careRequestId } = await createTestRequest();

      const results = await Promise.allSettled([
        createReviewAvailableNotifications(),
        createReviewAvailableNotifications(),
      ]);

      const notifications = await findReviewAvailableNotifications(careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);

      const createdCount = results.reduce(
        (count, result) =>
          result.status === "fulfilled"
            ? count +
              result.value.notifications.filter(
                (notification) => notification.careRequestId === careRequestId,
              ).length
            : count,
        0,
      );

      assert.equal(createdCount, 1);
    });

    // 알림 저장 오류를 전파하고, 다음 실행에서 누락된 알림을 생성하는지 확인
    it("DB 알림 저장 실패 시 오류를 전파하고 다음 실행에서 누락 알림을 생성한다", async () => {
      const { careRequestId } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        createReviewAvailableNotifications(createNotificationFailureRunner(notificationError)),
        (error: unknown) => error === notificationError,
      );

      assert.equal((await findReviewAvailableNotifications(careRequestId)).length, 0);

      const retryResult = await createReviewAvailableNotifications();
      const notifications = await findReviewAvailableNotifications(careRequestId);

      assert.equal(notifications.length, 1);
      assert.ok(
        retryResult.notifications.some(
          (notification) =>
            notification.id === notifications[0].id && notification.careRequestId === careRequestId,
        ),
      );
    });

    // 후보 조회 후 리뷰가 생성되면 트랜잭션 내부의 재검증에서 제외되는지 확인
    it("후보 조회 이후 리뷰가 생성되면 알림 저장 전 재검증에서 제외한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      let reviewCreated = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!reviewCreated) {
          await prisma.review.create({
            data: {
              careRequestId,
              ownerId,
              sitterId,
              rating: 5,
              content: "정말 친절하셨어요.",
            },
          });
          reviewCreated = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createReviewAvailableNotifications(runTransaction);

      assert.equal(reviewCreated, true);
      assert.equal((await findReviewAvailableNotifications(careRequestId)).length, 0);
      assert.equal(
        result.notifications.some((notification) => notification.careRequestId === careRequestId),
        false,
      );
    });

    // 실제 리뷰 생성과 예약 알림 생성을 동시에 실행하여 DB 정합성 확인
    it("리뷰 생성과 예약 알림 생성이 경합해도 중복 저장 없이 정합성을 유지한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const [reviewResult, notificationResult] = await Promise.allSettled([
        createReview(ownerId, careRequestId, {
          rating: 5,
          content: "정말 친절하셨어요.",
        }),
        createReviewAvailableNotifications(),
      ]);

      assert.ok(reviewResult.status === "fulfilled");
      assert.ok(notificationResult.status === "fulfilled");

      const reviews = await prisma.review.findMany({
        where: { careRequestId },
      });

      const availableNotifications = await findReviewAvailableNotifications(careRequestId);

      const receivedNotifications = await prisma.notification.findMany({
        where: {
          careRequestId,
          type: "REVIEW_RECEIVED",
        },
      });

      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].ownerId, ownerId);
      assert.equal(reviews[0].sitterId, sitterId);

      assert.equal(receivedNotifications.length, 1);
      assert.equal(receivedNotifications[0].reviewId, reviews[0].id);
      assert.equal(receivedNotifications[0].recipientId, sitterId);

      // 리뷰가 먼저 반영되면 0건, 예약 알림 생성이 먼저 완료되면 1건 허용
      assert.ok(availableNotifications.length <= 1);

      if (availableNotifications.length === 1) {
        assert.equal(availableNotifications[0].recipientId, ownerId);
        assert.equal(availableNotifications[0].readAt, null);
      }

      assert.equal(
        notificationResult.value.notifications.filter(
          (notification) => notification.careRequestId === careRequestId,
        ).length,
        availableNotifications.length,
      );
    });
  });
});
