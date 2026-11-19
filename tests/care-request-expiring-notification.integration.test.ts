import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { lockCareRequestForUpdate } from "../src/repositories/care-request-repository.js";
import {
  updateCareRequest,
  cancelCareRequestService,
} from "../src/services/care-request-service.js";
import { createCareRequestExpiringNotifications } from "../src/services/care-request-expiring-notification-service.js";
import { confirmQuoteService } from "../src/services/quote-service.js";
import type { TransactionRunner } from "../src/types/db.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 각 테스트에서 사용할 독립적인 팟오너 및 돌봄 요청 생성
async function createTestRequest(
  options: {
    startOffsetDays?: number;
    status?: "OPEN" | "MATCHED" | "EXPIRED" | "CANCELED";
    withQuote?: boolean;
  } = {},
) {
  const { startOffsetDays = 0, status = "OPEN", withQuote = false } = options;
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `care-expiring-owner-${uniqueId}@example.com`,
      nickname: `care-expiring-owner-${uniqueId}`,
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

  let quoteId: bigint | null = null;

  if (withQuote) {
    const sitter = await prisma.user.create({
      data: {
        email: `care-expiring-sitter-${uniqueId}@example.com`,
        nickname: `care-expiring-sitter-${uniqueId}`,
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

    const quote = await prisma.quote.create({
      data: {
        careRequestId: careRequest.id,
        sitterId: sitter.id,
        type: "GENERAL",
        price: 50000,
        comment: "테스트 견적 코멘트입니다.",
      },
    });

    quoteId = quote.id;

    if (status === "MATCHED") {
      await prisma.careRequest.update({
        where: { id: careRequest.id },
        data: { confirmedQuoteId: quote.id },
      });
    }
  }

  return {
    ownerId: owner.id,
    careRequestId: careRequest.id,
    quoteId,
  };
}

// 실제 트랜잭션에서 알림 저장 시점에만 오류 발생
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

// 해당 돌봄 요청의 만료 임박 알림 조회
function findExpiringNotifications(careRequestId: bigint) {
  return prisma.notification.findMany({
    where: {
      careRequestId,
      type: "CARE_REQUEST_EXPIRING",
    },
    orderBy: { id: "asc" },
  });
}

// 해당 돌봄 요청에 새로 생성된 알림 결과만 조회
function findCreatedNotifications(
  result: Awaited<ReturnType<typeof createCareRequestExpiringNotifications>>,
  careRequestId: bigint,
) {
  return result.notifications.filter(
    (notification) => notification.careRequestId === careRequestId,
  );
}

// 실제 DB 행 잠금 경합에서 첫 번째 도메인 작업을 먼저 커밋
async function runWithLockedRequest<T>(
  careRequestId: bigint,
  firstOperation: (runTransaction: TransactionRunner) => Promise<T>,
) {
  let notifyFirstReady!: () => void;
  let releaseFirstCommit!: () => void;
  let notifySecondStarted!: (pid: number) => void;

  const firstReady = new Promise<void>((resolve) => {
    notifyFirstReady = resolve;
  });

  const firstCommitAllowed = new Promise<void>((resolve) => {
    releaseFirstCommit = resolve;
  });

  const secondStarted = new Promise<number>((resolve) => {
    notifySecondStarted = resolve;
  });

  const firstRunner: TransactionRunner = (callback) =>
    prisma.$transaction(async (tx) => {
      const result = await callback(tx);
      notifyFirstReady();
      await firstCommitAllowed;
      return result;
    });

  const secondRunner: TransactionRunner = (callback) =>
    prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;

      notifySecondStarted(pid);
      return callback(tx);
    });

  const firstResult = firstOperation(firstRunner);
  let notificationResult: ReturnType<typeof createCareRequestExpiringNotifications> | undefined;

  try {
    await Promise.race([
      firstReady,
      firstResult.then(
        () => {
          throw new Error("첫 번째 트랜잭션이 예상보다 먼저 종료되었습니다.");
        },
        (error: unknown) => {
          throw error;
        },
      ),
    ]);

    notificationResult = createCareRequestExpiringNotifications(secondRunner);

    const secondPid = await Promise.race([
      secondStarted,
      notificationResult.then(
        () => {
          throw new Error("행 잠금 경합 전에 알림 생성이 종료되었습니다.");
        },
        (error: unknown) => {
          throw error;
        },
      ),
    ]);

    const deadline = Date.now() + 2000;
    let wasBlocked = false;

    while (Date.now() < deadline) {
      const [{ blockingPids }] = await prisma.$queryRaw<{ blockingPids: number[] }[]>`
        SELECT pg_blocking_pids(${secondPid}::integer) AS "blockingPids"
      `;

      if (blockingPids.length > 0) {
        wasBlocked = true;
        break;
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }

    assert.equal(wasBlocked, true);
  } finally {
    releaseFirstCommit();
  }

  const [operation, notification] = await Promise.allSettled([firstResult, notificationResult!]);

  return { operation, notification, careRequestId };
}

describe("활성 돌봄 요청 만료 임박 알림 생성", () => {
  describe("생성 조건", () => {
    // 시작일 당일 팟오너에게 올바른 유형·메시지로 알림 생성 확인
    it("OPEN 요청의 시작일 당일 팟오너에게 CARE_REQUEST_EXPIRING 알림을 생성한다", async () => {
      const fixture = await createTestRequest();
      const before = new Date();

      const result = await createCareRequestExpiringNotifications();
      const after = new Date();
      const notifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.ownerId);
      assert.equal(notifications[0].careRequestId, fixture.careRequestId);
      assert.equal(notifications[0].type, "CARE_REQUEST_EXPIRING");
      assert.equal(notifications[0].message, "확정하지 않은 돌봄요청이 내일 만료돼요!");
      assert.equal(notifications[0].readAt, null);
      assert.ok(notifications[0].createdAt >= before);
      assert.ok(notifications[0].createdAt <= after);

      const created = findCreatedNotifications(result, fixture.careRequestId);

      assert.equal(created.length, 1);
      assert.equal(created[0].id, notifications[0].id);
      assert.equal(created[0].recipientId, fixture.ownerId);
      assert.equal(created[0].scheduledDate, getTodayInKst());
      assert.equal(result.careRequestExpiringNotificationCount, result.notifications.length);
    });

    // 시작일 이전이거나 지난 요청은 소급 생성하지 않음
    it("발생 예정일이 아닌 요청은 알림 생성 대상에서 제외한다", async () => {
      const requests = await Promise.all([
        createTestRequest({ startOffsetDays: 1 }),
        createTestRequest({ startOffsetDays: -1 }),
        createTestRequest({ startOffsetDays: -3 }),
      ]);

      const result = await createCareRequestExpiringNotifications();

      for (const request of requests) {
        assert.equal((await findExpiringNotifications(request.careRequestId)).length, 0);
        assert.equal(findCreatedNotifications(result, request.careRequestId).length, 0);
      }
    });

    // OPEN 상태가 아닌 요청 제외
    it("OPEN 상태 조건을 충족하지 않으면 생성하지 않는다", async () => {
      const requests = await Promise.all([
        createTestRequest({ status: "MATCHED", withQuote: true }),
        createTestRequest({ status: "EXPIRED" }),
        createTestRequest({ status: "CANCELED" }),
      ]);

      const result = await createCareRequestExpiringNotifications();

      for (const request of requests) {
        assert.equal((await findExpiringNotifications(request.careRequestId)).length, 0);
        assert.equal(findCreatedNotifications(result, request.careRequestId).length, 0);
      }
    });

    // 예정일 당일에는 누락된 알림을 생성할 수 있는지 확인
    it("예정일 당일 누락된 알림은 재실행 시 생성한다", async () => {
      const fixture = await createTestRequest({ startOffsetDays: 1 });

      const firstResult = await createCareRequestExpiringNotifications();

      assert.equal(findCreatedNotifications(firstResult, fixture.careRequestId).length, 0);

      await prisma.careRequest.update({
        where: { id: fixture.careRequestId },
        data: { startDate: dateOffset(0) },
      });

      const secondResult = await createCareRequestExpiringNotifications();
      const notifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(findCreatedNotifications(secondResult, fixture.careRequestId).length, 1);
    });

    // 반복 실행해도 이미 생성된 동일 유형의 알림 중복 방지
    it("반복 실행해도 이미 생성된 동일 유형의 알림을 중복 생성하지 않는다", async () => {
      const fixture = await createTestRequest();

      const firstResult = await createCareRequestExpiringNotifications();
      const firstNotifications = await findExpiringNotifications(fixture.careRequestId);

      const secondResult = await createCareRequestExpiringNotifications();
      const secondNotifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(firstNotifications.length, 1);
      assert.equal(findCreatedNotifications(firstResult, fixture.careRequestId).length, 1);
      assert.equal(secondNotifications.length, 1);
      assert.equal(secondNotifications[0].id, firstNotifications[0].id);
      assert.equal(findCreatedNotifications(secondResult, fixture.careRequestId).length, 0);
    });

    // 이미 생성된 동일 유형의 알림은 읽음 여부와 관계없이 중복 생성하지 않는지 확인
    it("이미 생성된 동일 유형의 알림은 읽음 여부와 관계없이 중복 생성하지 않는다", async () => {
      const unreadRequest = await createTestRequest();
      const readRequest = await createTestRequest();
      const readAt = new Date();

      const unreadNotification = await prisma.notification.create({
        data: {
          recipientId: unreadRequest.ownerId,
          careRequestId: unreadRequest.careRequestId,
          type: "CARE_REQUEST_EXPIRING",
          message: "기존 미확인 알림",
        },
      });

      const readNotification = await prisma.notification.create({
        data: {
          recipientId: readRequest.ownerId,
          careRequestId: readRequest.careRequestId,
          type: "CARE_REQUEST_EXPIRING",
          message: "기존 확인 알림",
          readAt,
        },
      });

      const result = await createCareRequestExpiringNotifications();

      const unreadNotifications = await findExpiringNotifications(unreadRequest.careRequestId);
      const readNotifications = await findExpiringNotifications(readRequest.careRequestId);

      assert.equal(unreadNotifications.length, 1);
      assert.equal(unreadNotifications[0].id, unreadNotification.id);
      assert.equal(unreadNotifications[0].readAt, null);

      assert.equal(readNotifications.length, 1);
      assert.equal(readNotifications[0].id, readNotification.id);
      assert.deepEqual(readNotifications[0].readAt, readAt);

      assert.equal(findCreatedNotifications(result, unreadRequest.careRequestId).length, 0);
      assert.equal(findCreatedNotifications(result, readRequest.careRequestId).length, 0);
    });

    // 다른 유형의 알림 존재 여부와 독립적으로 생성
    it("다른 유형의 알림이 이미 생성되어 있어도 만료 임박 알림을 생성한다", async () => {
      const fixture = await createTestRequest();

      const otherNotification = await prisma.notification.create({
        data: {
          recipientId: fixture.ownerId,
          careRequestId: fixture.careRequestId,
          type: "QUOTE_RECEIVED",
          message: "기존 견적 수신 알림",
        },
      });

      const result = await createCareRequestExpiringNotifications();
      const notifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].type, "CARE_REQUEST_EXPIRING");
      assert.equal(notifications[0].recipientId, fixture.ownerId);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);

      const savedOtherNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: otherNotification.id },
      });

      assert.equal(savedOtherNotification.message, otherNotification.message);
      assert.equal(savedOtherNotification.readAt, null);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 동시 실행 시 동일 요청의 알림 중복 생성 방지
    it("동시에 두 번 실행해도 동일한 요청의 알림은 한 건만 생성한다", async () => {
      const fixture = await createTestRequest();

      const results = await Promise.allSettled([
        createCareRequestExpiringNotifications(),
        createCareRequestExpiringNotifications(),
      ]);

      const notifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
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

    // DB 저장 실패 후 예정일 당일 재실행에서 누락 알림 생성
    it("DB 알림 저장 실패 시 오류를 전파하고 예정일 당일 재실행에서 누락 알림을 생성한다", async () => {
      const fixture = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        createCareRequestExpiringNotifications(createNotificationFailureRunner(notificationError)),
        (error: unknown) => error === notificationError,
      );

      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);

      const retryResult = await createCareRequestExpiringNotifications();
      const notifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 1);
      assert.equal(findCreatedNotifications(retryResult, fixture.careRequestId).length, 1);
    });

    // 후보 조회 이후 요청이 확정되면 저장 전 재검증에서 제외
    it("후보 조회 이후 요청이 확정되면 알림 저장 전 재검증에서 제외한다", async () => {
      const fixture = await createTestRequest({ withQuote: true });
      let statusChanged = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!statusChanged) {
          await prisma.careRequest.update({
            where: { id: fixture.careRequestId },
            data: {
              status: "MATCHED",
              confirmedQuoteId: fixture.quoteId!,
            },
          });

          statusChanged = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createCareRequestExpiringNotifications(runTransaction);

      assert.equal(statusChanged, true);
      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 후보 조회 이후 시작일 변경 시 저장 전 재검증에서 제외
    it("후보 조회 이후 시작일이 변경되면 알림 저장 전 재검증에서 제외한다", async () => {
      const fixture = await createTestRequest();
      let scheduleChanged = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!scheduleChanged) {
          await prisma.careRequest.update({
            where: { id: fixture.careRequestId },
            data: { startDate: dateOffset(1) },
          });

          scheduleChanged = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createCareRequestExpiringNotifications(runTransaction);

      assert.equal(scheduleChanged, true);
      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 후보 조회 이후 요청 취소 시 저장 전 재검증에서 제외
    it("후보 조회 이후 요청이 취소되면 알림 저장 전 재검증에서 제외한다", async () => {
      const fixture = await createTestRequest();
      let statusChanged = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!statusChanged) {
          await prisma.careRequest.update({
            where: { id: fixture.careRequestId },
            data: { status: "CANCELED" },
          });

          statusChanged = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createCareRequestExpiringNotifications(runTransaction);

      assert.equal(statusChanged, true);
      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 실제 견적 확정과 예약 알림 생성 간 행 잠금 경합 검증
    it("견적 확정과 예약 알림 생성이 경합해도 정합성을 유지한다", async () => {
      const fixture = await createTestRequest({ withQuote: true });

      const result = await runWithLockedRequest(fixture.careRequestId, (runTransaction) =>
        confirmQuoteService(fixture.ownerId, fixture.quoteId!, runTransaction),
      );

      assert.equal(result.operation.status, "fulfilled");
      assert.equal(result.notification.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      assert.equal(savedRequest.confirmedQuoteId, fixture.quoteId);
      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);

      if (result.notification.status === "fulfilled") {
        assert.equal(
          findCreatedNotifications(result.notification.value, fixture.careRequestId).length,
          0,
        );
      }
    });

    // 실제 돌봄 요청 수정과 예약 알림 생성 간 행 잠금 경합 검증
    it("돌봄 요청 수정과 예약 알림 생성이 경합해도 정합성을 유지한다", async () => {
      const fixture = await createTestRequest();

      const result = await runWithLockedRequest(fixture.careRequestId, (runTransaction) =>
        updateCareRequest(
          fixture.ownerId,
          fixture.careRequestId,
          { endDate: dateOffset(5).toISOString().slice(0, 10) },
          runTransaction,
        ),
      );

      assert.equal(result.operation.status, "fulfilled");
      assert.equal(result.notification.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      const notifications = await findExpiringNotifications(fixture.careRequestId);

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.endDate.getTime(), dateOffset(5).getTime());
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, fixture.ownerId);

      if (result.notification.status === "fulfilled") {
        assert.equal(
          findCreatedNotifications(result.notification.value, fixture.careRequestId).length,
          1,
        );
      }
    });

    // 실제 돌봄 요청 취소와 예약 알림 생성 간 행 잠금 경합 검증
    it("돌봄 요청 취소와 예약 알림 생성이 경합해도 정합성을 유지한다", async () => {
      const fixture = await createTestRequest();

      const result = await runWithLockedRequest(fixture.careRequestId, (runTransaction) =>
        cancelCareRequestService(fixture.ownerId, fixture.careRequestId, runTransaction),
      );

      assert.equal(result.operation.status, "fulfilled");
      assert.equal(result.notification.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");
      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);

      if (result.notification.status === "fulfilled") {
        assert.equal(
          findCreatedNotifications(result.notification.value, fixture.careRequestId).length,
          0,
        );
      }
    });

    // 후보 조회 이후 KST 자정 경과 시 전일 예정 알림 생성 방지
    it("예약 알림 처리 중 KST 자정이 지나면 알림 저장을 중단한다", async (t) => {
      const fixture = await createTestRequest();
      const today = getTodayInKst();

      const beforeMidnight = new Date(`${today}T14:59:50.000Z`);
      const afterMidnight = new Date(`${today}T15:00:00.000Z`);

      t.mock.timers.enable({
        apis: ["Date"],
        now: beforeMidnight,
      });

      let dateChanged = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!dateChanged) {
          t.mock.timers.setTime(afterMidnight.getTime());
          dateChanged = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createCareRequestExpiringNotifications(runTransaction);

      assert.equal(dateChanged, true);
      assert.equal((await findExpiringNotifications(fixture.careRequestId)).length, 0);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });
  });
});
