import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { markNotificationAsRead } from "../src/services/notification-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
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
function createTestNotification(
  recipientId: bigint,
  careRequestId: bigint,
  options: Partial<
    Pick<
      Prisma.NotificationUncheckedCreateInput,
      "type" | "quoteId" | "designatedRequestId" | "reviewId"
    >
  > = {},
) {
  return prisma.notification.create({
    data: {
      recipientId,
      careRequestId,
      type: "QUOTE_RECEIVED",
      message: "알림 단건 읽음 처리 테스트입니다.",
      readAt: null,
      ...options,
    },
  });
}

// 테스트에 사용할 견적 생성
function createTestQuote(
  careRequestId: bigint,
  sitterId: bigint,
  type: Prisma.QuoteUncheckedCreateInput["type"] = "GENERAL",
) {
  return prisma.quote.create({
    data: {
      careRequestId,
      sitterId,
      type,
      price: 50000,
      comment: "테스트 견적 코멘트입니다.",
    },
  });
}

// 테스트에 사용할 지정 요청 생성
function createTestDesignatedRequest(careRequestId: bigint, sitterId: bigint) {
  return prisma.designatedRequest.create({
    data: {
      careRequestId,
      sitterId,
    },
  });
}

// 리뷰 상태 검증에 사용할 독립적인 확정 돌봄 요청 생성
async function createMatchedTestRequest(endDateOffset = -1) {
  const { ownerId, sitterId, careRequestId } = await createTestRequest();
  const quote = await createTestQuote(careRequestId, sitterId);

  await prisma.careRequest.update({
    where: { id: careRequestId },
    data: {
      status: "MATCHED",
      confirmedQuoteId: quote.id,
      startDate: futureDate(-7),
      endDate: futureDate(endDateOffset),
    },
  });

  return { ownerId, sitterId, careRequestId };
}

// 테스트에 사용할 리뷰 생성
function createTestReview(careRequestId: bigint, ownerId: bigint, sitterId: bigint) {
  return prisma.review.create({
    data: {
      careRequestId,
      ownerId,
      sitterId,
      rating: 5,
      content: "테스트용 리뷰입니다. 정말 친절하셨어요.",
    },
  });
}

// 지정된 DB 세션이 대상 UPDATE의 행 잠금 해제를 기다리는지 확인
async function waitForLockedUpdate(blockingPid: number, table: "Notification" | "CareRequest") {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ isWaiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND ${blockingPid} = ANY(pg_blocking_pids(pid))
          AND query ILIKE ${`%${table}%`}
          AND query ILIKE '%UPDATE%'
      ) AS "isWaiting"
    `;

    if (rows[0]?.isWaiting) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`${table} UPDATE의 행 잠금 대기를 확인하지 못했습니다.`);
}

// 다른 트랜잭션이 대상 레코드를 잠근 상태에서 읽음 처리 중 UPDATE를 대기시킨 후 변경 사항 커밋
async function runWithReadLock(
  recipientId: bigint,
  notificationId: bigint,
  changeRecord: (tx: Prisma.TransactionClient) => Promise<void>,
  target: {
    table: "Notification" | "CareRequest";
    id: bigint;
  } = {
    table: "Notification",
    id: notificationId,
  },
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
      if (target.table === "Notification") {
        await tx.$queryRaw`
          SELECT id
          FROM "Notification"
          WHERE id = ${target.id}
          FOR UPDATE
        `;
      } else {
        await tx.$queryRaw`
          SELECT id
          FROM "CareRequest"
          WHERE id = ${target.id}
          FOR UPDATE
        `;
      }

      const sessions = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid
      `;

      notifyLocked(sessions[0]!.pid);
      await releaseAllowed;
      await changeRecord(tx);
    },
    { timeout: 15000 },
  );

  const blockingPid = await locked;
  const readPromise = markNotificationAsRead(recipientId, notificationId);

  // 잠금 해제 전 발생한 오류도 처리할 수 있도록 Promise 결과 보관
  const settledRead = readPromise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );

  try {
    await waitForLockedUpdate(blockingPid, target.table);
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
  describe("정상 및 예외 처리", () => {
    // 존재하지 않는 알림에 대한 읽음 요청 시 NOTIFICATION_NOT_FOUND 반환 확인
    it("존재하지 않는 알림은 NOTIFICATION_NOT_FOUND를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      const missingNotificationId = notification.id + 1_000_000n;

      await assert.rejects(
        markNotificationAsRead(ownerId, missingNotificationId),
        assertAppError("NOTIFICATION_NOT_FOUND", 404),
      );

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(savedNotification.readAt, null);
    });

    // 타인 알림 읽음 요청 시 FORBIDDEN 반환 및 기존 읽음 상태 유지 확인
    it("타인 알림은 FORBIDDEN을 반환하고 readAt을 변경하지 않는다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      await assert.rejects(
        markNotificationAsRead(sitterId, notification.id),
        assertAppError("FORBIDDEN", 403),
      );

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(savedNotification.recipientId, ownerId);
      assert.equal(savedNotification.readAt, null);
    });

    // 시작일이 당일인 OPEN 요청은 만료 처리하지 않고 기존 상태를 유지하는지 확인
    it("시작일이 당일인 OPEN 요청은 기존 상태를 유지한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: {
          startDate: futureDate(0),
        },
      });

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "CARE_REQUEST_EXPIRING",
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      const savedCareRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedCareRequest.status, "OPEN");
      assert.equal(result.relatedStatus.careRequestStatus, "OPEN");
    });

    // 시작일이 경과한 OPEN 요청은 만료 처리 후 EXPIRED 상태를 반환하는지 확인
    it("시작일이 경과한 OPEN 요청은 만료 처리 후 EXPIRED 상태를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "CARE_REQUEST_EXPIRING",
      });

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: {
          startDate: futureDate(-1),
        },
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      const savedCareRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedCareRequest.status, "EXPIRED");
      assert.equal(result.relatedStatus.careRequestStatus, "EXPIRED");
    });

    // 지정 요청에 응답하지 않은 상태에서 견적 및 반려 ID의 null 반환 확인
    it("지정 요청 미응답 상태면 견적 및 반려 ID를 null로 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const designatedRequest = await createTestDesignatedRequest(careRequestId, sitterId);

      const notification = await createTestNotification(sitterId, careRequestId, {
        type: "DESIGNATED_REQUEST_RECEIVED",
        designatedRequestId: designatedRequest.id,
      });

      const result = await markNotificationAsRead(sitterId, notification.id);

      assert.deepEqual(result.relatedStatus, {
        careRequestStatus: "OPEN",
        quoteId: null,
        rejectedRequestId: null,
        reviewStatus: null,
      });
    });

    // 지정 요청을 반려한 상태에서 해당 반려 ID 반환 확인
    it("지정 요청을 반려한 상태면 반려 ID를 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const designatedRequest = await createTestDesignatedRequest(careRequestId, sitterId);

      const notification = await createTestNotification(sitterId, careRequestId, {
        type: "DESIGNATED_REQUEST_RECEIVED",
        designatedRequestId: designatedRequest.id,
      });

      const rejectedRequest = await prisma.rejectedRequest.create({
        data: {
          designatedRequestId: designatedRequest.id,
          reason: "해당 기간에는 돌봄 일정이 어렵습니다.",
        },
      });

      const result = await markNotificationAsRead(sitterId, notification.id);

      assert.deepEqual(result.relatedStatus, {
        careRequestStatus: "OPEN",
        quoteId: null,
        rejectedRequestId: rejectedRequest.id,
        reviewStatus: null,
      });
    });

    // 지정 요청 수신 알림에 필수 연결 ID가 없는 경우 데이터 정합성 오류 반환 확인
    it("지정 요청 수신 알림에 지정 요청 ID가 없으면 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();

      const notification = await createTestNotification(sitterId, careRequestId, {
        type: "DESIGNATED_REQUEST_RECEIVED",
      });

      await assert.rejects(
        markNotificationAsRead(sitterId, notification.id),
        assertAppError("INTERNAL_SERVER_ERROR", 500),
      );
    });

    // 알림과 지정 요청의 돌봄 요청 ID가 불일치하는 경우 데이터 정합성 오류 반환 확인
    it("알림과 지정 요청의 돌봄 요청 ID가 일치하지 않으면 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const otherRequest = await createTestRequest();

      const designatedRequest = await createTestDesignatedRequest(
        otherRequest.careRequestId,
        sitterId,
      );

      const notification = await createTestNotification(sitterId, careRequestId, {
        type: "DESIGNATED_REQUEST_RECEIVED",
        designatedRequestId: designatedRequest.id,
      });

      await assert.rejects(
        markNotificationAsRead(sitterId, notification.id),
        assertAppError("INTERNAL_SERVER_ERROR", 500),
      );
    });

    // 알림 수신자와 지정 요청 대상 팟트너가 불일치하는 경우 데이터 정합성 오류 반환 확인
    it("알림 수신자와 지정 요청 대상 팟트너가 일치하지 않으면 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const otherRequest = await createTestRequest();

      const designatedRequest = await createTestDesignatedRequest(
        careRequestId,
        otherRequest.sitterId,
      );

      const notification = await createTestNotification(sitterId, careRequestId, {
        type: "DESIGNATED_REQUEST_RECEIVED",
        designatedRequestId: designatedRequest.id,
      });

      await assert.rejects(
        markNotificationAsRead(sitterId, notification.id),
        assertAppError("INTERNAL_SERVER_ERROR", 500),
      );
    });

    // 지정 요청 수신 알림이 아닌 경우 연결 데이터가 있어도 관련 ID의 null 반환 확인
    it("지정 요청 반려 알림은 반려 이력이 존재해도 견적 및 반려 ID를 null로 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const designatedRequest = await createTestDesignatedRequest(careRequestId, sitterId);

      await prisma.rejectedRequest.create({
        data: {
          designatedRequestId: designatedRequest.id,
          reason: "해당 기간에는 돌봄 일정이 어렵습니다.",
        },
      });

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "DESIGNATED_REQUEST_REJECTED",
        designatedRequestId: designatedRequest.id,
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      assert.deepEqual(result.relatedStatus, {
        careRequestStatus: "OPEN",
        quoteId: null,
        rejectedRequestId: null,
        reviewStatus: null,
      });
    });

    // 돌봄 종료일 당일에는 리뷰 작성 불가 상태 반환 확인
    it("돌봄 종료일이 당일인 리뷰 미작성 상태면 UNAVAILABLE을 반환한다", async () => {
      const { ownerId, careRequestId } = await createMatchedTestRequest(0);

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "REVIEW_AVAILABLE",
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      assert.deepEqual(result.relatedStatus, {
        careRequestStatus: "MATCHED",
        quoteId: null,
        rejectedRequestId: null,
        reviewStatus: "UNAVAILABLE",
      });
    });

    // 돌봄 요청이 확정 상태가 아닌 경우 리뷰 작성 불가 상태 반환 확인
    it("돌봄 요청이 MATCHED 상태가 아니면 리뷰 상태를 UNAVAILABLE로 반환한다", async () => {
      const { ownerId, careRequestId } = await createMatchedTestRequest();

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: { status: "EXPIRED" },
      });

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "REVIEW_AVAILABLE",
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      assert.equal(result.relatedStatus.reviewStatus, "UNAVAILABLE");
    });

    // 확정 견적이 없는 경우 리뷰 작성 불가 상태 반환 확인
    it("MATCHED 상태이지만 확정 견적이 없으면 리뷰 상태를 UNAVAILABLE로 반환한다", async () => {
      const { ownerId, careRequestId } = await createMatchedTestRequest();

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: { confirmedQuoteId: null },
      });

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "REVIEW_AVAILABLE",
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      assert.equal(result.relatedStatus.reviewStatus, "UNAVAILABLE");
    });

    // 리뷰 수신 알림의 리뷰 작성 및 삭제 이력에 따른 상태 반환 확인
    for (const reviewStatus of ["WRITTEN", "DELETED"] as const) {
      it(`리뷰 수신 알림의 리뷰가 ${reviewStatus} 상태면 해당 리뷰 상태를 반환한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createMatchedTestRequest();

        const review = await createTestReview(careRequestId, ownerId, sitterId);

        const notification = await createTestNotification(sitterId, careRequestId, {
          type: "REVIEW_RECEIVED",
          reviewId: review.id,
        });

        if (reviewStatus === "DELETED") {
          await prisma.review.update({
            where: { id: review.id },
            data: { deletedAt: new Date() },
          });
        }

        const result = await markNotificationAsRead(sitterId, notification.id);

        assert.deepEqual(result.relatedStatus, {
          careRequestStatus: "MATCHED",
          quoteId: null,
          rejectedRequestId: null,
          reviewStatus,
        });
      });
    }

    // 리뷰 관련 알림이 아닌 경우 리뷰 작성 이력이 있어도 관련 상태의 null 반환 확인
    it("돌봄 시작 알림은 리뷰 작성 이력이 존재해도 리뷰 상태를 null로 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createMatchedTestRequest();

      await createTestReview(careRequestId, ownerId, sitterId);

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "OWNER_CARE_STARTED",
      });

      const result = await markNotificationAsRead(ownerId, notification.id);

      assert.deepEqual(result.relatedStatus, {
        careRequestStatus: "MATCHED",
        quoteId: null,
        rejectedRequestId: null,
        reviewStatus: null,
      });
    });

    // 이미 읽은 지정 요청 수신 알림의 재요청 시 최초 읽음 시각 및 최신 견적 ID 반환 확인
    it("이미 읽은 지정 요청 수신 알림은 기존 readAt과 최신 견적 ID를 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const designatedRequest = await createTestDesignatedRequest(careRequestId, sitterId);

      const notification = await createTestNotification(sitterId, careRequestId, {
        type: "DESIGNATED_REQUEST_RECEIVED",
        designatedRequestId: designatedRequest.id,
      });

      const firstResult = await markNotificationAsRead(sitterId, notification.id);

      assert.ok(firstResult.readAt instanceof Date);
      assert.equal(firstResult.relatedStatus.quoteId, null);

      const quote = await createTestQuote(careRequestId, sitterId, "DESIGNATED");

      const repeatedResult = await markNotificationAsRead(sitterId, notification.id);

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(repeatedResult.readAt?.getTime(), firstResult.readAt.getTime());
      assert.equal(savedNotification.readAt?.getTime(), firstResult.readAt.getTime());

      assert.deepEqual(repeatedResult.relatedStatus, {
        careRequestStatus: "OPEN",
        quoteId: quote.id,
        rejectedRequestId: null,
        reviewStatus: null,
      });
    });

    // 이미 읽은 리뷰 작성 가능 알림의 재요청 시 최초 읽음 시각 및 최신 리뷰 상태 반환 확인
    it("이미 읽은 리뷰 작성 가능 알림은 기존 readAt과 최신 리뷰 상태를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createMatchedTestRequest();

      const notification = await createTestNotification(ownerId, careRequestId, {
        type: "REVIEW_AVAILABLE",
      });

      const firstResult = await markNotificationAsRead(ownerId, notification.id);

      assert.ok(firstResult.readAt instanceof Date);
      assert.equal(firstResult.relatedStatus.reviewStatus, "AVAILABLE");

      const review = await createTestReview(careRequestId, ownerId, sitterId);

      const writtenResult = await markNotificationAsRead(ownerId, notification.id);

      assert.equal(writtenResult.readAt?.getTime(), firstResult.readAt.getTime());
      assert.equal(writtenResult.relatedStatus.reviewStatus, "WRITTEN");

      await prisma.review.update({
        where: { id: review.id },
        data: { deletedAt: new Date() },
      });

      const deletedResult = await markNotificationAsRead(ownerId, notification.id);

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(deletedResult.readAt?.getTime(), firstResult.readAt.getTime());
      assert.equal(savedNotification.readAt?.getTime(), firstResult.readAt.getTime());
      assert.equal(deletedResult.relatedStatus.reviewStatus, "DELETED");
    });
  });
  describe("동시성 및 트랜잭션", () => {
    // 동일 알림의 동시 읽음 요청 시 최초 읽음 시각 및 관련 상태 반환 확인
    it("동일 알림의 동시 읽음 요청 시 최초 readAt과 관련 상태를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const quote = await createTestQuote(careRequestId, sitterId);

      const notification = await createTestNotification(ownerId, careRequestId, {
        quoteId: quote.id,
      });

      const results = await Promise.all([
        markNotificationAsRead(ownerId, notification.id),
        markNotificationAsRead(ownerId, notification.id),
      ]);

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.ok(savedNotification.readAt instanceof Date);

      for (const result of results) {
        assert.equal(result.id, notification.id);
        assert.ok(result.readAt instanceof Date);
        assert.equal(result.readAt.getTime(), savedNotification.readAt.getTime());

        assert.deepEqual(result.relatedStatus, {
          careRequestStatus: "OPEN",
          quoteId: null,
          rejectedRequestId: null,
          reviewStatus: null,
        });
      }

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: {
          status: "MATCHED",
          confirmedQuoteId: quote.id,
        },
      });

      const repeatedResult = await markNotificationAsRead(ownerId, notification.id);

      assert.equal(repeatedResult.id, notification.id);
      assert.ok(repeatedResult.readAt instanceof Date);
      assert.equal(repeatedResult.readAt.getTime(), savedNotification.readAt.getTime());

      assert.deepEqual(repeatedResult.relatedStatus, {
        careRequestStatus: "MATCHED",
        quoteId: null,
        rejectedRequestId: null,
        reviewStatus: null,
      });

      const repeatedSavedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(repeatedSavedNotification.readAt?.getTime(), savedNotification.readAt.getTime());
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // 다른 트랜잭션이 먼저 읽음 처리하고 관련 돌봄 요청 상태를 변경한 경우 최신 정보 반환 확인
    it("P2025 이후 읽음 완료 상태면 기존 readAt과 최신 관련 상태를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const quote = await createTestQuote(careRequestId, sitterId);

      const notification = await createTestNotification(ownerId, careRequestId, {
        quoteId: quote.id,
      });

      const firstReadAt = new Date("2026-11-11T01:00:00.000Z");

      const result = await runWithReadLock(ownerId, notification.id, async (tx) => {
        await tx.notification.update({
          where: { id: notification.id },
          data: { readAt: firstReadAt },
        });

        await tx.careRequest.update({
          where: { id: careRequestId },
          data: {
            status: "MATCHED",
            confirmedQuoteId: quote.id,
          },
        });
      });

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(result.id, notification.id);
      assert.ok(result.readAt instanceof Date);
      assert.equal(result.readAt.getTime(), firstReadAt.getTime());
      assert.equal(savedNotification.readAt?.getTime(), firstReadAt.getTime());

      assert.deepEqual(result.relatedStatus, {
        careRequestStatus: "MATCHED",
        quoteId: null,
        rejectedRequestId: null,
        reviewStatus: null,
      });
    });

    // 다른 트랜잭션이 알림을 삭제하면 P2025 이후 NOTIFICATION_NOT_FOUND로 변환하는지 확인
    it("P2025 이후 알림이 삭제되면 NOTIFICATION_NOT_FOUND를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      await assert.rejects(
        runWithReadLock(ownerId, notification.id, async (tx) => {
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
        runWithReadLock(ownerId, notification.id, async (tx) => {
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
        runWithReadLock(ownerId, notification.id, async (tx) => {
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

    // 돌봄 요청 만료 처리 중 다른 트랜잭션이 상태를 변경한 경우 P2025 이후 최신 상태 반환 확인
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`돌봄 요청 만료 처리 중 P2025 발생 이후 ${status} 상태면 해당 상태를 반환한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createTestRequest();
        const quote = await createTestQuote(careRequestId, sitterId);

        const notification = await createTestNotification(ownerId, careRequestId, {
          quoteId: quote.id,
        });

        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: {
            startDate: futureDate(-1),
          },
        });

        const result = await runWithReadLock(
          ownerId,
          notification.id,
          async (tx) => {
            await tx.careRequest.update({
              where: { id: careRequestId },
              data: {
                status,
                ...(status === "MATCHED" ? { confirmedQuoteId: quote.id } : {}),
                ...(status === "CANCELED" ? { canceledAt: new Date() } : {}),
              },
            });
          },
          {
            table: "CareRequest",
            id: careRequestId,
          },
        );

        const savedCareRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        const savedNotification = await prisma.notification.findUniqueOrThrow({
          where: { id: notification.id },
        });

        assert.equal(savedCareRequest.status, status);

        assert.equal(result.id, notification.id);
        assert.ok(result.readAt instanceof Date);
        assert.equal(result.readAt.getTime(), savedNotification.readAt?.getTime());

        assert.deepEqual(result.relatedStatus, {
          careRequestStatus: status,
          quoteId: null,
          rejectedRequestId: null,
          reviewStatus: null,
        });
      });
    }
  });
});
