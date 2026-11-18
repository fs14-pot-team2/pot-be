import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { lockCareRequestForUpdate } from "../src/repositories/care-request-repository.js";
import { createCareScheduleNotifications } from "../src/services/care-schedule-notification-service.js";
import type { TransactionRunner } from "../src/types/db.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

const careScheduleTypes = [
  "OWNER_CARE_STARTED",
  "SITTER_CARE_STARTED",
  "OWNER_CARE_ENDING",
  "SITTER_CARE_ENDING",
] as const;

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 각 테스트에서 사용할 독립적인 팟오너, 팟트너 및 돌봄 요청 생성
async function createTestRequest(
  options: {
    startOffsetDays?: number;
    endOffsetDays?: number;
    status?: "MATCHED" | "OPEN" | "EXPIRED" | "CANCELED";
    confirmed?: boolean;
  } = {},
) {
  const { startOffsetDays = 0, endOffsetDays = 3, status = "MATCHED", confirmed = true } = options;

  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `care-schedule-owner-${uniqueId}@example.com`,
      nickname: `care-schedule-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `care-schedule-sitter-${uniqueId}@example.com`,
      nickname: `care-schedule-sitter-${uniqueId}`,
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
      startDate: dateOffset(startOffsetDays),
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
    ownerNickname: owner.nickname,
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

// 해당 요청의 복수 알림 저장 후 트랜잭션 실패 시 전체 롤백 확인
function createPostInsertFailureRunner(
  careRequestId: bigint,
  notificationError: Error,
): TransactionRunner {
  return (callback) =>
    prisma.$transaction(async (tx) => {
      const result = await callback(tx);

      const savedCount = await tx.notification.count({
        where: {
          careRequestId,
          type: { in: [...careScheduleTypes] },
        },
      });

      if (savedCount === 2) {
        throw notificationError;
      }

      return result;
    });
}

// 특정 돌봄 요청의 돌봄 일정 알림 조회
function findCareScheduleNotifications(careRequestId: bigint) {
  return prisma.notification.findMany({
    where: {
      careRequestId,
      type: { in: [...careScheduleTypes] },
    },
    orderBy: { id: "asc" },
  });
}

// 특정 돌봄 요청에 새로 생성된 알림 결과만 조회
function findCreatedNotifications(
  result: Awaited<ReturnType<typeof createCareScheduleNotifications>>,
  careRequestId: bigint,
) {
  return result.notifications.filter(
    (notification) => notification.careRequestId === careRequestId,
  );
}

describe("돌봄 일정 알림 생성", () => {
  describe("생성 조건", () => {
    // 시작일 당일 팟오너와 확정 팟트너에게 각각 올바른 유형·메시지로 알림 생성 확인
    it("돌봄 시작일 당일 팟오너와 확정 팟트너에게 돌봄 시작 알림을 생성한다", async () => {
      const fixture = await createTestRequest();
      const before = new Date();
      const result = await createCareScheduleNotifications();
      const after = new Date();
      const notifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 2);

      assert.deepEqual(
        notifications.map(({ type, recipientId, message }) => ({ type, recipientId, message })),
        [
          {
            type: "OWNER_CARE_STARTED",
            recipientId: fixture.ownerId,
            message: `${fixture.sitterNickname} 팟트너의 돌봄이 시작되는 날이에요!`,
          },
          {
            type: "SITTER_CARE_STARTED",
            recipientId: fixture.sitterId,
            message: `${fixture.ownerNickname} 팟오너의 돌봄이 시작되는 날이에요!`,
          },
        ],
      );

      for (const notification of notifications) {
        assert.equal(notification.careRequestId, fixture.careRequestId);
        assert.equal(notification.readAt, null);
        assert.ok(notification.createdAt >= before && notification.createdAt <= after);

        assert.ok(
          result.notifications.some(
            (created) =>
              created.id === notification.id &&
              created.recipientId === notification.recipientId &&
              created.careRequestId === fixture.careRequestId &&
              created.event === "STARTED" &&
              created.scheduledDate === getTodayInKst(),
          ),
        );
      }

      assert.equal(result.careScheduleNotificationCount, result.notifications.length);
    });

    // 종료일 하루 전 팟오너와 확정 팟트너에게 각각 올바른 유형·메시지로 알림 생성 확인
    it("돌봄 종료일 하루 전 팟오너와 확정 팟트너에게 돌봄 종료 임박 알림을 생성한다", async () => {
      const fixture = await createTestRequest({
        startOffsetDays: -3,
        endOffsetDays: 1,
      });

      const result = await createCareScheduleNotifications();
      const notifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 2);

      assert.deepEqual(
        notifications.map(({ type, recipientId, message }) => ({ type, recipientId, message })),
        [
          {
            type: "OWNER_CARE_ENDING",
            recipientId: fixture.ownerId,
            message: `${fixture.sitterNickname} 팟트너의 돌봄 종료가 하루 남았어요.`,
          },
          {
            type: "SITTER_CARE_ENDING",
            recipientId: fixture.sitterId,
            message: `${fixture.ownerNickname} 팟오너의 돌봄 종료가 하루 남았어요.`,
          },
        ],
      );

      for (const notification of notifications) {
        assert.equal(notification.careRequestId, fixture.careRequestId);
        assert.equal(notification.readAt, null);
        assert.ok(notification.createdAt instanceof Date);

        assert.ok(
          result.notifications.some(
            (created) =>
              created.id === notification.id &&
              created.recipientId === notification.recipientId &&
              created.careRequestId === fixture.careRequestId &&
              created.event === "ENDING" &&
              created.scheduledDate === getTodayInKst(),
          ),
        );
      }
    });

    // 시작일 또는 종료 임박 예정일에 해당하지 않는 요청은 소급 생성하지 않음
    it("발생 예정일이 아닌 요청은 알림 생성 대상에서 제외한다", async () => {
      const requests = await Promise.all([
        createTestRequest({ startOffsetDays: 1, endOffsetDays: 4 }),
        createTestRequest({ startOffsetDays: -4, endOffsetDays: -1 }),
        createTestRequest({ startOffsetDays: -3, endOffsetDays: 0 }),
        createTestRequest({ startOffsetDays: -3, endOffsetDays: 2 }),
      ]);

      const result = await createCareScheduleNotifications();

      for (const request of requests) {
        assert.equal((await findCareScheduleNotifications(request.careRequestId)).length, 0);

        assert.equal(findCreatedNotifications(result, request.careRequestId).length, 0);
      }
    });

    // MATCHED 상태 또는 확정 견적 조건을 충족하지 않는 요청 제외
    it("MATCHED 상태 또는 확정 견적 조건을 충족하지 않으면 생성하지 않는다", async () => {
      const requests = await Promise.all([
        createTestRequest({ status: "OPEN", confirmed: false }),
        createTestRequest({ status: "EXPIRED" }),
        createTestRequest({ status: "CANCELED" }),
        createTestRequest({ confirmed: false }),
      ]);

      const result = await createCareScheduleNotifications();

      for (const request of requests) {
        assert.equal((await findCareScheduleNotifications(request.careRequestId)).length, 0);

        assert.equal(findCreatedNotifications(result, request.careRequestId).length, 0);
      }
    });

    // 한쪽 수신자에게 동일 유형 알림이 있으면 누락된 상대 알림만 생성
    it("이미 생성된 동일 유형의 알림이 한쪽 수신자에게만 있으면 누락된 알림만 생성한다", async () => {
      const fixture = await createTestRequest();

      const existing = await prisma.notification.create({
        data: {
          recipientId: fixture.ownerId,
          careRequestId: fixture.careRequestId,
          type: "OWNER_CARE_STARTED",
          message: "기존 돌봄 시작 알림",
        },
      });

      const result = await createCareScheduleNotifications();
      const notifications = await findCareScheduleNotifications(fixture.careRequestId);
      const created = findCreatedNotifications(result, fixture.careRequestId);

      assert.equal(notifications.length, 2);
      assert.equal(notifications[0].id, existing.id);
      assert.equal(notifications[0].message, existing.message);
      assert.equal(notifications[1].type, "SITTER_CARE_STARTED");
      assert.equal(notifications[1].recipientId, fixture.sitterId);
      assert.equal(created.length, 1);
      assert.equal(created[0].id, notifications[1].id);
      assert.equal(created[0].event, "STARTED");
    });

    // 반복 실행해도 이미 생성된 동일 유형의 알림을 중복 생성하지 않는지 확인
    it("반복 실행해도 이미 생성된 동일 유형의 알림을 중복 생성하지 않는다", async () => {
      const fixture = await createTestRequest();

      await createCareScheduleNotifications();

      const firstNotifications = await findCareScheduleNotifications(fixture.careRequestId);
      const secondResult = await createCareScheduleNotifications();
      const secondNotifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(firstNotifications.length, 2);

      assert.deepEqual(
        secondNotifications.map((notification) => notification.id),
        firstNotifications.map((notification) => notification.id),
      );

      assert.equal(findCreatedNotifications(secondResult, fixture.careRequestId).length, 0);
    });

    // 이미 생성된 동일 유형의 알림은 읽음 여부와 관계없이 중복 생성하지 않는지 확인
    it("이미 생성된 동일 유형의 알림은 읽음 여부와 관계없이 중복 생성하지 않는다", async () => {
      const fixture = await createTestRequest();
      const readAt = new Date();

      const ownerNotification = await prisma.notification.create({
        data: {
          recipientId: fixture.ownerId,
          careRequestId: fixture.careRequestId,
          type: "OWNER_CARE_STARTED",
          message: "기존 확인 알림",
          readAt,
        },
      });

      const sitterNotification = await prisma.notification.create({
        data: {
          recipientId: fixture.sitterId,
          careRequestId: fixture.careRequestId,
          type: "SITTER_CARE_STARTED",
          message: "기존 미확인 알림",
        },
      });

      const result = await createCareScheduleNotifications();
      const notifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 2);

      assert.deepEqual(
        notifications.map((notification) => notification.id),
        [ownerNotification.id, sitterNotification.id],
      );

      assert.deepEqual(notifications[0].readAt, readAt);
      assert.equal(notifications[1].readAt, null);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 시작 알림과 종료 임박 알림이 같은 요청에서 독립적으로 생성되는지 확인
    it("시작 알림과 종료 임박 알림은 서로 독립적으로 생성한다", async () => {
      const fixture = await createTestRequest({
        startOffsetDays: 0,
        endOffsetDays: 1,
      });

      const result = await createCareScheduleNotifications();
      const notifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 4);

      assert.deepEqual(
        new Set(notifications.map((notification) => notification.type)),
        new Set(careScheduleTypes),
      );

      const created = findCreatedNotifications(result, fixture.careRequestId);

      assert.equal(created.length, 4);
      assert.equal(created.filter((notification) => notification.event === "STARTED").length, 2);
      assert.equal(created.filter((notification) => notification.event === "ENDING").length, 2);

      const repeatResult = await createCareScheduleNotifications();

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 4);

      assert.equal(findCreatedNotifications(repeatResult, fixture.careRequestId).length, 0);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 동시 실행 시 동일 요청의 수신자별 알림을 중복 생성하지 않는지 확인
    it("동시에 두 번 실행해도 동일한 요청의 알림은 수신자별 한 건만 생성한다", async () => {
      const fixture = await createTestRequest();

      const results = await Promise.allSettled([
        createCareScheduleNotifications(),
        createCareScheduleNotifications(),
      ]);

      const notifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
      assert.equal(notifications.length, 2);

      assert.deepEqual(
        new Set(notifications.map((notification) => notification.type)),
        new Set(["OWNER_CARE_STARTED", "SITTER_CARE_STARTED"]),
      );

      const createdCount = results.reduce(
        (count, result) =>
          result.status === "fulfilled"
            ? count + findCreatedNotifications(result.value, fixture.careRequestId).length
            : count,
        0,
      );

      assert.equal(createdCount, 2);
    });

    // 팟오너와 팟트너 알림 2건이 저장된 후 오류가 발생해도 전체 롤백되는지 확인
    it("복수 알림 저장 후 트랜잭션 실패 시 해당 요청의 알림을 모두 롤백한다", async () => {
      const fixture = await createTestRequest();
      const notificationError = new Error("Notification transaction failed");

      await assert.rejects(
        createCareScheduleNotifications(
          createPostInsertFailureRunner(fixture.careRequestId, notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);
    });

    // DB 저장 실패 후 예정일 당일 재실행에서 누락 알림을 생성하는지 확인
    it("DB 알림 저장 실패 시 오류를 전파하고 예정일 당일 재실행에서 누락 알림을 생성한다", async () => {
      const fixture = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        createCareScheduleNotifications(createNotificationFailureRunner(notificationError)),
        (error: unknown) => error === notificationError,
      );

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);

      const retryResult = await createCareScheduleNotifications();
      const notifications = await findCareScheduleNotifications(fixture.careRequestId);

      assert.equal(notifications.length, 2);
      assert.equal(findCreatedNotifications(retryResult, fixture.careRequestId).length, 2);
    });

    // 후보 조회 이후 돌봄 요청 상태가 변경되면 저장 전 재검증에서 제외되는지 확인
    it("후보 조회 이후 돌봄 요청 상태가 변경되면 알림 저장 전 재검증에서 제외한다", async () => {
      const fixture = await createTestRequest();
      let statusChanged = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!statusChanged) {
          await prisma.careRequest.update({
            where: { id: fixture.careRequestId },
            data: { status: "EXPIRED" },
          });

          statusChanged = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createCareScheduleNotifications(runTransaction);

      assert.equal(statusChanged, true);

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);

      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 후보 조회 이후 DB의 돌봄 일정이 변경되면 저장 전 재검증에서 제외하는지 확인
    it("후보 조회 이후 돌봄 일정이 변경되면 알림 저장 전 재검증에서 제외한다", async () => {
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

      const result = await createCareScheduleNotifications(runTransaction);

      assert.equal(scheduleChanged, true);

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);

      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 후보 조회 이후 확정 견적이 사라지면 저장 전 재검증에서 제외되는지 확인
    it("후보 조회 이후 확정 견적이 없어지면 알림 저장 전 재검증에서 제외한다", async () => {
      const fixture = await createTestRequest();
      let confirmationRemoved = false;

      const runTransaction: TransactionRunner = async (callback) => {
        if (!confirmationRemoved) {
          await prisma.careRequest.update({
            where: { id: fixture.careRequestId },
            data: { confirmedQuoteId: null },
          });

          confirmationRemoved = true;
        }

        return prisma.$transaction(callback);
      };

      const result = await createCareScheduleNotifications(runTransaction);

      assert.equal(confirmationRemoved, true);

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);

      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });

    // 실제 DB 행 잠금 경합 이후 변경된 요청 상태를 기준으로 알림 생성 제외 확인
    it("돌봄 요청 상태 변경과 예약 알림 생성이 경합해도 정합성을 유지한다", async () => {
      const fixture = await createTestRequest();

      let notifyLocked!: (pid: number) => void;
      let releaseLock!: () => void;
      let notifySecondStarted!: (pid: number) => void;

      const locked = new Promise<number>((resolve) => {
        notifyLocked = resolve;
      });

      const lockReleased = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      const secondStarted = new Promise<number>((resolve) => {
        notifySecondStarted = resolve;
      });

      const changeStatus = prisma.$transaction(async (tx) => {
        await lockCareRequestForUpdate(fixture.careRequestId, tx);

        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;

        notifyLocked(pid);
        await lockReleased;

        await tx.careRequest.update({
          where: { id: fixture.careRequestId },
          data: { status: "EXPIRED" },
        });
      });

      const firstPid = await locked;

      const runTransaction: TransactionRunner = (callback) =>
        prisma.$transaction(async (tx) => {
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
            SELECT pg_backend_pid() AS pid
          `;

          notifySecondStarted(pid);
          return callback(tx);
        });

      const createNotifications = createCareScheduleNotifications(runTransaction);

      try {
        const secondPid = await Promise.race([
          secondStarted,
          createNotifications.then(
            () => {
              throw new Error("행 잠금 경합 전에 알림 생성이 종료되었습니다.");
            },
            (error: unknown) => {
              throw error;
            },
          ),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error("알림 생성 트랜잭션 진입 대기 시간이 초과되었습니다."));
            }, 5000);
          }),
        ]);

        let wasBlocked = false;

        const deadline = Date.now() + 2000;

        while (Date.now() < deadline) {
          const [{ blockingPids }] = await prisma.$queryRaw<{ blockingPids: number[] }[]>`
            SELECT pg_blocking_pids(${secondPid}::integer) AS "blockingPids"
          `;

          if (blockingPids.includes(firstPid)) {
            wasBlocked = true;
            break;
          }

          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          });
        }

        assert.equal(wasBlocked, true);
      } finally {
        releaseLock();
      }

      const [statusResult, notificationResult] = await Promise.allSettled([
        changeStatus,
        createNotifications,
      ]);

      assert.equal(statusResult.status, "fulfilled");
      assert.ok(notificationResult.status === "fulfilled");

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);

      assert.equal(
        findCreatedNotifications(notificationResult.value, fixture.careRequestId).length,
        0,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
    });

    // 후보 조회 이후 KST 자정이 지나면 전일 예정 알림을 생성하지 않는지 확인
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

      const result = await createCareScheduleNotifications(runTransaction);

      assert.equal(dateChanged, true);

      assert.equal((await findCareScheduleNotifications(fixture.careRequestId)).length, 0);

      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 0);
    });
  });
});
