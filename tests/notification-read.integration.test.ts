import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, mock } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { readNotification } from "../src/services/notification-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// Prisma P2025 충돌 오류 생성
function createP2025Error() {
  return Object.assign(new Error("Record not found"), {
    code: "P2025",
  });
}

// Prisma P2025 원본 오류 전달 확인
function assertP2025(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2025";
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `notification-read-owner-${uniqueId}@example.com`,
      nickname: `notification-read-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `notification-read-sitter-${uniqueId}@example.com`,
      nickname: `notification-read-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
    },
  });

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: futureDate(7),
      endDate: futureDate(14),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: careRequest.id,
  };
}

// 테스트에 사용할 미확인 알림 생성
function createTestNotification(recipientId: bigint, careRequestId: bigint) {
  return prisma.notification.create({
    data: {
      recipientId,
      careRequestId,
      type: "QUOTE_RECEIVED",
      message: "알림 단건 읽음 처리 테스트입니다.",
      readAt: null,
    },
  });
}

// 지정된 DB 세션이 알림 UPDATE의 행 잠금 해제를 기다리는지 확인
async function waitForNotificationUpdate(blockingPid: number) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ isWaiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND ${blockingPid} = ANY(pg_blocking_pids(pid))
          AND query ILIKE '%Notification%'
          AND query ILIKE '%UPDATE%'
      ) AS "isWaiting"
    `;

    if (rows[0]?.isWaiting) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("알림 UPDATE의 행 잠금 대기를 확인하지 못했습니다.");
}

// 다른 트랜잭션이 알림을 잠근 상태에서 읽음 처리 UPDATE를 대기시킨 후 변경 사항 커밋
async function runWithNotificationLock(
  recipientId: bigint,
  notificationId: bigint,
  changeNotification: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  let notifyLocked!: (pid: number) => void;
  let releaseLock!: () => void;

  const locked = new Promise<number>((resolve) => {
    notifyLocked = resolve;
  });

  const releaseAllowed = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const lockingTransaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Notification"
        WHERE id = ${notificationId}
        FOR UPDATE
      `;

      const sessions = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid
      `;

      notifyLocked(sessions[0]!.pid);
      await releaseAllowed;
      await changeNotification(tx);
    },
    { timeout: 15000 },
  );

  const blockingPid = await locked;
  const readPromise = readNotification(recipientId, notificationId);

  // 잠금 해제 전 발생한 오류도 처리할 수 있도록 Promise 결과 보관
  const settledRead = readPromise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );

  try {
    await waitForNotificationUpdate(blockingPid);
  } finally {
    releaseLock();
  }

  await lockingTransaction;
  const outcome = await settledRead;

  if (outcome.status === "rejected") {
    throw outcome.reason;
  }

  return outcome.value;
}

describe("알림 단건 읽음 처리", () => {
  describe("동시성 및 트랜잭션", () => {
    // 동일 알림의 동시 읽음 요청이 최초 읽음 시각을 공유하고 DB 상태를 유지하는지 확인
    it("동일 알림의 동시 읽음 요청 시 최초 readAt을 유지한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      const results = await Promise.all([
        readNotification(ownerId, notification.id),
        readNotification(ownerId, notification.id),
      ]);

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.ok(savedNotification.readAt instanceof Date);

      for (const result of results) {
        assert.equal(result.id, notification.id);
        assert.ok(result.readAt instanceof Date);
        assert.equal(result.readAt.getTime(), savedNotification.readAt.getTime());
      }

      const repeatedResult = await readNotification(ownerId, notification.id);

      assert.equal(repeatedResult.id, notification.id);
      assert.ok(repeatedResult.readAt instanceof Date);
      assert.equal(repeatedResult.readAt.getTime(), savedNotification.readAt.getTime());
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // 다른 트랜잭션이 먼저 읽음 처리하면 P2025 이후 최신 읽음 시각을 반환하는지 확인
    it("P2025 이후 읽음 완료 상태면 기존 readAt을 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);
      const firstReadAt = new Date("2026-11-11T01:00:00.000Z");

      const result = await runWithNotificationLock(ownerId, notification.id, async (tx) => {
        await tx.notification.update({
          where: { id: notification.id },
          data: { readAt: firstReadAt },
        });
      });

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(result.id, notification.id);
      assert.ok(result.readAt instanceof Date);
      assert.equal(result.readAt.getTime(), firstReadAt.getTime());
      assert.equal(savedNotification.readAt?.getTime(), firstReadAt.getTime());
    });

    // 다른 트랜잭션이 알림을 삭제하면 P2025 이후 NOTIFICATION_NOT_FOUND로 변환하는지 확인
    it("P2025 이후 알림이 삭제되면 NOTIFICATION_NOT_FOUND를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      await assert.rejects(
        runWithNotificationLock(ownerId, notification.id, async (tx) => {
          await tx.notification.delete({
            where: { id: notification.id },
          });
        }),
        assertAppError("NOTIFICATION_NOT_FOUND", 404),
      );

      const deletedNotification = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      assert.equal(deletedNotification, null);
    });

    // 다른 트랜잭션이 수신자를 변경하면 P2025 이후 접근 권한 오류로 변환하는지 확인
    it("P2025 이후 수신자가 일치하지 않으면 FORBIDDEN을 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      await assert.rejects(
        runWithNotificationLock(ownerId, notification.id, async (tx) => {
          await tx.notification.update({
            where: { id: notification.id },
            data: { recipientId: sitterId },
          });
        }),
        assertAppError("FORBIDDEN", 403),
      );

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(savedNotification.recipientId, sitterId);
      assert.equal(savedNotification.readAt, null);
    });

    // P2025 이후 알림이 여전히 미확인 상태면 원본 Prisma 오류를 전달하는지 확인
    it("P2025 이후 미확인 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      await assert.rejects(
        runWithNotificationLock(ownerId, notification.id, async (tx) => {
          await tx.notification.delete({
            where: { id: notification.id },
          });

          await tx.notification.create({
            data: {
              id: notification.id,
              recipientId: notification.recipientId,
              careRequestId: notification.careRequestId,
              type: notification.type,
              message: notification.message,
              readAt: null,
              createdAt: notification.createdAt,
            },
          });
        }),
        assertP2025,
      );

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(savedNotification.recipientId, ownerId);
      assert.equal(savedNotification.readAt, null);
    });
  });
});
