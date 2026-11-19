import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import {
  expireCareRequestIfPast,
  expirePastCareRequests,
} from "../src/services/care-request-expiration.js";
import type { TransactionRunner } from "../src/types/db.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

type QuoteType = "GENERAL" | "DESIGNATED";
type CareRequestStatus = "OPEN" | "MATCHED" | "EXPIRED" | "CANCELED";

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 각 테스트에서 사용할 독립적인 팟트너 생성
async function createTestSitter() {
  const uniqueId = randomUUID();

  return prisma.user.create({
    data: {
      email: `expired-sitter-${uniqueId}@example.com`,
      nickname: `expired-sitter-${uniqueId}`,
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
}

// 각 테스트에서 사용할 독립적인 팟오너, 요청 및 견적 생성
async function createTestRequest(
  options: {
    startOffsetDays?: number;
    status?: CareRequestStatus;
    quoteTypes?: QuoteType[];
  } = {},
) {
  const { startOffsetDays = -1, status = "OPEN", quoteTypes = ["GENERAL"] } = options;

  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `expired-owner-${uniqueId}@example.com`,
      nickname: `expired-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: dateOffset(startOffsetDays),
      endDate: dateOffset(Math.max(startOffsetDays + 3, 3)),
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

  const sitters: {
    id: bigint;
    type: QuoteType;
  }[] = [];

  let firstQuoteId: bigint | null = null;

  for (const type of quoteTypes) {
    const sitter = await createTestSitter();

    if (type === "DESIGNATED") {
      await prisma.designatedRequest.create({
        data: {
          careRequestId: careRequest.id,
          sitterId: sitter.id,
        },
      });
    }

    const quote = await prisma.quote.create({
      data: {
        careRequestId: careRequest.id,
        sitterId: sitter.id,
        type,
        price: 50000,
        comment: "테스트 견적 코멘트입니다.",
      },
    });

    firstQuoteId ??= quote.id;
    sitters.push({ id: sitter.id, type });
  }

  if (status === "MATCHED" && firstQuoteId !== null) {
    await prisma.careRequest.update({
      where: { id: careRequest.id },
      data: { confirmedQuoteId: firstQuoteId },
    });
  }

  return {
    ownerId: owner.id,
    ownerNickname: owner.nickname,
    careRequestId: careRequest.id,
    sitters,
  };
}

// 해당 돌봄 요청에 저장된 만료 알림 조회
function findExpiredNotifications(careRequestId: bigint) {
  return prisma.notification.findMany({
    where: {
      careRequestId,
      type: "CARE_REQUEST_EXPIRED",
    },
    orderBy: { id: "asc" },
  });
}

// 실행 결과 중 해당 돌봄 요청에 신규 생성된 알림만 조회
function findCreatedNotifications(
  result: Awaited<ReturnType<typeof expirePastCareRequests>>,
  careRequestId: bigint,
) {
  return result.notifications.filter(
    (notification) => notification.careRequestId === careRequestId,
  );
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

describe("돌봄 요청 만료 알림 생성", () => {
  describe("생성 조건", () => {
    // 시작일이 지난 OPEN 요청을 만료하고 견적 제출 팟트너에게 알림 생성
    it("시작일이 지난 OPEN 요청을 만료 처리하고 견적 제출 팟트너에게 CARE_REQUEST_EXPIRED 알림을 생성한다", async () => {
      const fixture = await createTestRequest();
      const before = new Date();

      const result = await expirePastCareRequests();

      const after = new Date();
      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(notifications.length, 1);

      const notification = notifications[0];

      assert.equal(notification.recipientId, fixture.sitters[0].id);
      assert.equal(notification.careRequestId, fixture.careRequestId);
      assert.equal(notification.type, "CARE_REQUEST_EXPIRED");
      assert.equal(notification.message, `${fixture.ownerNickname} 팟오너의 요청이 만료 되었어요.`);
      assert.equal(notification.readAt, null);
      assert.ok(notification.createdAt >= before);
      assert.ok(notification.createdAt <= after);

      const created = findCreatedNotifications(result, fixture.careRequestId);

      assert.equal(created.length, 1);
      assert.equal(created[0].id, notification.id);
      assert.equal(created[0].recipientId, fixture.sitters[0].id);

      assert.equal(result.careRequestExpiredNotificationCount, result.notifications.length);
    });

    // 일반·지정 견적의 구분 없이 실제 견적 제출자별 알림 생성
    it("일반·지정 견적을 제출한 팟트너 각각에게 알림을 생성한다", async () => {
      const fixture = await createTestRequest({
        quoteTypes: ["GENERAL", "DESIGNATED"],
      });

      const result = await expirePastCareRequests();
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 2);
      assert.deepEqual(
        notifications.map(({ recipientId }) => recipientId).sort(),
        fixture.sitters.map(({ id }) => id).sort(),
      );

      for (const notification of notifications) {
        assert.equal(
          notification.message,
          `${fixture.ownerNickname} 팟오너의 요청이 만료 되었어요.`,
        );
        assert.equal(notification.readAt, null);
      }

      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 2);
    });

    // 지정 요청 수신·반려만으로는 알림 수신 대상이 되지 않음
    it("견적을 제출하지 않은 지정 요청 대상자와 반려한 팟트너는 알림 생성 대상에서 제외한다", async () => {
      const fixture = await createTestRequest();
      const designatedSitter = await createTestSitter();
      const rejectedSitter = await createTestSitter();

      await prisma.designatedRequest.create({
        data: {
          careRequestId: fixture.careRequestId,
          sitterId: designatedSitter.id,
        },
      });

      await prisma.designatedRequest.create({
        data: {
          careRequestId: fixture.careRequestId,
          sitterId: rejectedSitter.id,
          rejectedRequest: {
            create: {
              reason: "이번 일정에는 돌봄을 진행하기 어렵습니다.",
            },
          },
        },
      });

      const result = await expirePastCareRequests();
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.sitters[0].id);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);

      assert.equal(
        notifications.some(
          ({ recipientId }) =>
            recipientId === designatedSitter.id || recipientId === rejectedSitter.id,
        ),
        false,
      );
    });

    // 견적이 없는 요청도 기간 경과 시 만료 상태로 변경
    it("견적이 없는 요청도 만료 처리하되 알림은 생성하지 않는다", async () => {
      const fixture = await createTestRequest({ quoteTypes: [] });

      const result = await expirePastCareRequests();
      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal((await findExpiredNotifications(fixture.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 만료 예정일 포함 4일간의 시작일 경계 조건 확인
    it("만료 예정일부터 4일간 누락 알림을 생성하고 허용 기간이 지나면 제외한다", async () => {
      const eligibleRequests = await Promise.all(
        [-1, -2, -3, -4].map((startOffsetDays) =>
          createTestRequest({
            startOffsetDays,
            status: "EXPIRED",
          }),
        ),
      );

      const excludedRequest = await createTestRequest({
        startOffsetDays: -5,
        status: "EXPIRED",
      });

      const result = await expirePastCareRequests();

      for (const fixture of eligibleRequests) {
        const notifications = await findExpiredNotifications(fixture.careRequestId);

        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].recipientId, fixture.sitters[0].id);
        assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);
      }

      assert.equal((await findExpiredNotifications(excludedRequest.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, excludedRequest.careRequestId).length, 0);
    });

    // 매칭·취소 요청 및 시작일 미경과 OPEN 요청은 알림 대상에서 제외
    it("MATCHED·CANCELED 및 시작일이 지나지 않은 OPEN 요청은 알림 생성 대상에서 제외한다", async () => {
      const requests = await Promise.all([
        createTestRequest({ status: "MATCHED" }),
        createTestRequest({ status: "CANCELED" }),
        createTestRequest({ startOffsetDays: 0 }),
        createTestRequest({ startOffsetDays: 1 }),
      ]);

      const result = await expirePastCareRequests();

      for (const fixture of requests) {
        assert.equal((await findExpiredNotifications(fixture.careRequestId)).length, 0);
        assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
      }

      const statuses = await Promise.all(
        requests.map(({ careRequestId }) =>
          prisma.careRequest.findUniqueOrThrow({
            where: { id: careRequestId },
            select: { status: true },
          }),
        ),
      );

      assert.deepEqual(
        statuses.map(({ status }) => status),
        ["MATCHED", "CANCELED", "OPEN", "OPEN"],
      );
    });

    // 개별 API에서 선행 만료한 견적 요청도 허용 기간 내 누락 알림 생성
    it("개별 API에서 먼저 만료 처리한 요청도 견적이 존재하고 허용 기간 내라면 알림을 생성한다", async () => {
      const fixture = await createTestRequest();
      const request = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      const expired = await expireCareRequestIfPast(request);

      assert.equal(expired, true);
      assert.equal((await findExpiredNotifications(fixture.careRequestId)).length, 0);

      const result = await expirePastCareRequests();
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.sitters[0].id);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
    });

    // 만료 처리 자체는 오래된 OPEN 요청에도 적용하되 알림 소급 생성은 제한
    it("허용 기간이 지난 OPEN 요청은 만료 처리하되 알림은 생성하지 않는다", async () => {
      const fixture = await createTestRequest({
        startOffsetDays: -5,
        status: "OPEN",
      });

      const result = await expirePastCareRequests();
      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal((await findExpiredNotifications(fixture.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 기존 동일 유형의 알림은 읽음 여부와 관계없이 중복 생성 방지
    it("이미 생성된 동일 유형의 알림은 읽음 여부와 관계없이 중복 생성하지 않는다", async () => {
      const unreadRequest = await createTestRequest({ status: "EXPIRED" });
      const readRequest = await createTestRequest({ status: "EXPIRED" });
      const readAt = new Date();

      const unreadNotification = await prisma.notification.create({
        data: {
          recipientId: unreadRequest.sitters[0].id,
          careRequestId: unreadRequest.careRequestId,
          type: "CARE_REQUEST_EXPIRED",
          message: "기존 미확인 알림",
        },
      });

      const readNotification = await prisma.notification.create({
        data: {
          recipientId: readRequest.sitters[0].id,
          careRequestId: readRequest.careRequestId,
          type: "CARE_REQUEST_EXPIRED",
          message: "기존 확인 알림",
          readAt,
        },
      });

      const result = await expirePastCareRequests();
      const unreadNotifications = await findExpiredNotifications(unreadRequest.careRequestId);
      const readNotifications = await findExpiredNotifications(readRequest.careRequestId);

      assert.equal(unreadNotifications.length, 1);
      assert.equal(unreadNotifications[0].id, unreadNotification.id);
      assert.equal(unreadNotifications[0].readAt, null);

      assert.equal(readNotifications.length, 1);
      assert.equal(readNotifications[0].id, readNotification.id);
      assert.deepEqual(readNotifications[0].readAt, readAt);

      assert.equal(findCreatedNotifications(result, unreadRequest.careRequestId).length, 0);
      assert.equal(findCreatedNotifications(result, readRequest.careRequestId).length, 0);
    });

    // 동일 요청에서 기존 알림이 없는 수신자에게만 신규 알림 생성
    it("일부 수신자의 알림만 누락된 경우 누락된 알림만 생성한다", async () => {
      const fixture = await createTestRequest({
        status: "EXPIRED",
        quoteTypes: ["GENERAL", "DESIGNATED"],
      });

      const existingNotification = await prisma.notification.create({
        data: {
          recipientId: fixture.sitters[0].id,
          careRequestId: fixture.careRequestId,
          type: "CARE_REQUEST_EXPIRED",
          message: "기존 만료 알림",
        },
      });

      const result = await expirePastCareRequests();
      const notifications = await findExpiredNotifications(fixture.careRequestId);
      const created = findCreatedNotifications(result, fixture.careRequestId);

      assert.equal(notifications.length, 2);
      assert.equal(created.length, 1);
      assert.equal(created[0].recipientId, fixture.sitters[1].id);

      const original = notifications.find(
        ({ recipientId }) => recipientId === fixture.sitters[0].id,
      );

      assert.equal(original?.id, existingNotification.id);
      assert.equal(original?.message, "기존 만료 알림");
    });

    // 기존 다른 유형의 알림과 독립적으로 만료 알림 생성
    it("다른 유형의 알림이 이미 생성되어 있어도 만료 알림을 생성한다", async () => {
      const fixture = await createTestRequest();

      const existingNotification = await prisma.notification.create({
        data: {
          recipientId: fixture.ownerId,
          careRequestId: fixture.careRequestId,
          type: "CARE_REQUEST_EXPIRING",
          message: "확정하지 않은 돌봄요청이 내일 만료돼요!",
        },
      });

      const result = await expirePastCareRequests();
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.sitters[0].id);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);

      const existing = await prisma.notification.findUniqueOrThrow({
        where: { id: existingNotification.id },
      });

      assert.equal(existing.type, "CARE_REQUEST_EXPIRING");
      assert.equal(existing.readAt, null);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // Lambda 중복 실행 시 동일 요청의 상태와 수신자별 알림 정합성 확인
    it("동시에 두 번 실행해도 동일한 요청의 만료와 알림 생성을 중복 처리하지 않는다", async () => {
      const fixture = await createTestRequest();

      const results = await Promise.allSettled([
        expirePastCareRequests(),
        expirePastCareRequests(),
      ]);

      const notifications = await findExpiredNotifications(fixture.careRequestId);
      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(results.filter(({ status }) => status === "fulfilled").length, 2);
      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(notifications.length, 1);

      const createdCount = results.reduce(
        (count, result) =>
          result.status === "fulfilled"
            ? count + findCreatedNotifications(result.value, fixture.careRequestId).length
            : count,
        0,
      );

      assert.equal(createdCount, 1);
    });

    // 개별 만료 처리와 정기 Lambda 실행 간 실제 DB 경합 결과 확인
    it("개별 API의 선행 만료 처리와 정기 Lambda 만료 처리가 경합해도 정합성을 유지한다", async () => {
      const fixture = await createTestRequest();
      const request = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      const results = await Promise.allSettled([
        expireCareRequestIfPast(request),
        expirePastCareRequests(),
      ]);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(results[1].status, "fulfilled");
      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.sitters[0].id);

      // Lambda가 먼저 만료한 경우 개별 조건부 UPDATE는 P2025가 발생할 수 있음
      if (results[0].status === "rejected") {
        const error = results[0].reason as { code?: string };
        assert.equal(error.code, "P2025");
      } else {
        assert.equal(results[0].value, true);
      }

      if (results[1].status === "fulfilled") {
        assert.equal(findCreatedNotifications(results[1].value, fixture.careRequestId).length, 1);
      }
    });

    // 알림 저장 실패 시 같은 트랜잭션의 만료 상태 변경까지 롤백
    it("알림 저장 실패 시 만료 상태 변경을 롤백하고 DB 오류를 전파한다", async () => {
      const fixture = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        expirePastCareRequests(createNotificationFailureRunner(notificationError)),
        (error: unknown) => error === notificationError,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal((await findExpiredNotifications(fixture.careRequestId)).length, 0);
    });

    // 알림 저장 실패 후 허용 기간 내 재실행에서 누락 알림 복구
    it("DB 알림 저장 실패 후 허용 기간 내 재실행에서 누락 알림을 생성한다", async () => {
      const fixture = await createTestRequest({ status: "EXPIRED" });
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        expirePastCareRequests(createNotificationFailureRunner(notificationError)),
        (error: unknown) => error === notificationError,
      );

      assert.equal((await findExpiredNotifications(fixture.careRequestId)).length, 0);

      const retryResult = await expirePastCareRequests();
      const notifications = await findExpiredNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.sitters[0].id);
      assert.equal(findCreatedNotifications(retryResult, fixture.careRequestId).length, 1);
    });
  });
});
