import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { Response } from "express";

import { prisma } from "../src/config/prisma.js";
import { createReview } from "../src/services/review-service.js";
import type { TransactionRunner } from "../src/types/db.js";
import { getTodayInKst } from "../src/utils/kst-date.js";
import { addSseClient, removeSseClient } from "../src/services/sse-service.js";

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 각 테스트에서 사용할 독립적인 팟오너, 팟트너 및 확정 돌봄 요청 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `review-notification-owner-${uniqueId}@example.com`,
      nickname: `review-notification-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `review-notification-sitter-${uniqueId}@example.com`,
      nickname: `review-notification-sitter-${uniqueId}`,
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
      startDate: dateOffset(-7),
      endDate: dateOffset(-1),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "MATCHED",
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

  await prisma.careRequest.update({
    where: { id: careRequest.id },
    data: { confirmedQuoteId: quote.id },
  });

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: careRequest.id,
  };
}

// 테스트 사용자의 SSE 연결을 등록하고 전송된 이벤트 수집
function createSseEventCollector(userId: bigint, failWrite = false) {
  const events: string[] = [];

  const response = {
    writableEnded: false,
    destroyed: false,
    write(frame: string) {
      if (failWrite) {
        throw new Error("SSE write failed");
      }

      events.push(frame);
      return true;
    },
  } as unknown as Response;

  addSseClient(userId, response);

  return {
    events,
    response,
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
                if (method === "create") {
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

describe("리뷰 도메인 알림 생성", () => {
  describe("SSE 이벤트 발행", () => {
    // 트랜잭션이 완료되기 전에는 이벤트를 발행하지 않는지 확인
    it("리뷰 생성과 알림 저장 트랜잭션 완료 이후 SSE 이벤트를 발행한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const { events, response } = createSseEventCollector(sitterId);

      t.after(() => removeSseClient(sitterId, response));

      const runTransaction: TransactionRunner = async (callback) => {
        const transactionResult = await prisma.$transaction(callback);

        assert.equal(events.length, 0);

        return transactionResult;
      };

      const createdReview = await createReview(
        ownerId,
        careRequestId,
        {
          rating: 5,
          content: "정말 친절하셨어요.",
        },
        runTransaction,
      );

      const notification = await prisma.notification.findFirstOrThrow({
        where: {
          reviewId: BigInt(createdReview.id),
          type: "REVIEW_RECEIVED",
        },
      });

      assert.equal(notification.recipientId, sitterId);

      assert.deepEqual(events, [
        `event: notification.created\ndata: {"notificationId":"${notification.id}"}\n\n`,
      ]);
    });

    // SSE 전송 실패가 커밋된 리뷰와 알림의 정상 처리 결과에 영향을 주지 않는지 확인
    it("SSE 이벤트 전송 실패 시에도 리뷰 생성 결과를 유지한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const { response } = createSseEventCollector(sitterId, true);

      t.after(() => removeSseClient(sitterId, response));

      const createdReview = await createReview(ownerId, careRequestId, {
        rating: 5,
        content: "정말 친절하셨어요.",
      });

      const savedReview = await prisma.review.findUniqueOrThrow({
        where: { id: BigInt(createdReview.id) },
      });

      const notification = await prisma.notification.findFirstOrThrow({
        where: {
          reviewId: savedReview.id,
          type: "REVIEW_RECEIVED",
        },
      });

      assert.equal(savedReview.id.toString(), createdReview.id);
      assert.equal(savedReview.careRequestId, careRequestId);
      assert.equal(notification.recipientId, sitterId);
      assert.equal(notification.reviewId, savedReview.id);
    });
  });

  describe("트랜잭션", () => {
    // 알림 저장 실패 시 같은 트랜잭션에서 생성한 리뷰를 롤백하고 SSE 이벤트를 발행하지 않는지 확인
    it("알림 저장 실패 시 리뷰 생성을 롤백한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");
      const { events, response } = createSseEventCollector(sitterId);

      t.after(() => removeSseClient(sitterId, response));

      await assert.rejects(
        createReview(
          ownerId,
          careRequestId,
          {
            rating: 5,
            content: "정말 친절하셨어요.",
          },
          createNotificationFailureRunner(notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      assert.equal(
        await prisma.review.count({
          where: { careRequestId },
        }),
        0,
      );

      assert.equal(
        await prisma.notification.count({
          where: { careRequestId },
        }),
        0,
      );

      assert.equal(events.length, 0);
    });
  });
});
