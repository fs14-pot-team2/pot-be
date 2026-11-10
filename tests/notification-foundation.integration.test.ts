import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { ERROR_DEFINITIONS } from "../src/errors/error-definitions.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// Prisma P2002 원본 오류 전달 확인
function assertP2002(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2002" &&
    !(error instanceof AppError)
  );
}

// Prisma P2003 원본 오류 전달 확인
function assertP2003(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2003" &&
    !(error instanceof AppError)
  );
}

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 테스트 데이터가 로컬 DB에 남지 않도록 트랜잭션 롤백
async function runRolledBack(callback: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollbackError = new Error("Notification test rollback");

  try {
    await prisma.$transaction(async (tx) => {
      await callback(tx);
      throw rollbackError;
    });
  } catch (error) {
    if (error !== rollbackError) {
      throw error;
    }
  }
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 연관 데이터 생성
async function createTestRequest(tx: Prisma.TransactionClient) {
  const uniqueId = randomUUID();

  const owner = await tx.user.create({
    data: {
      email: `notification-owner-${uniqueId}@example.com`,
      nickname: `notification-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await tx.user.create({
    data: {
      email: `notification-sitter-${uniqueId}@example.com`,
      nickname: `notification-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
    },
  });

  const careRequest = await tx.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: futureDate(7),
      endDate: futureDate(14),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: "테스트용 상세 주소",
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  const quote = await tx.quote.create({
    data: {
      careRequestId: careRequest.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 10000,
      comment: "테스트용 견적 내용입니다.",
    },
  });

  const designatedRequest = await tx.designatedRequest.create({
    data: {
      careRequestId: careRequest.id,
      sitterId: sitter.id,
    },
  });

  const review = await tx.review.create({
    data: {
      careRequestId: careRequest.id,
      ownerId: owner.id,
      sitterId: sitter.id,
      rating: 5,
      content: "테스트용 리뷰입니다.",
    },
  });

  return {
    recipientId: owner.id,
    careRequestId: careRequest.id,
    quoteId: quote.id,
    designatedRequestId: designatedRequest.id,
    reviewId: review.id,
  };
}

describe("알림 데이터 모델", () => {
  describe("인덱스 검증", () => {
    // 마이그레이션으로 일반 인덱스 2개와 부분 UNIQUE 인덱스 4개가 생성됐는지 확인
    it("알림 조회 인덱스 2개와 부분 UNIQUE 인덱스 4개를 유지한다", async () => {
      const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'Notification'
      `;

      const indexNames = new Set(indexes.map((index) => index.indexname));

      for (const name of [
        "Notification_recipientId_createdAt_id_idx",
        "Notification_recipientId_readAt_idx",
        "Notification_unique_quote_event_idx",
        "Notification_unique_designated_event_idx",
        "Notification_unique_review_event_idx",
        "Notification_unique_care_request_event_idx",
      ]) {
        assert.ok(indexNames.has(name), `${name} 인덱스가 없습니다.`);
      }

      for (const name of [
        "Notification_unique_quote_event_idx",
        "Notification_unique_designated_event_idx",
        "Notification_unique_review_event_idx",
        "Notification_unique_care_request_event_idx",
      ]) {
        const index = indexes.find((item) => item.indexname === name);

        assert.ok(index);
        assert.match(index.indexdef, /CREATE UNIQUE INDEX/);
        assert.match(index.indexdef, /WHERE/);
      }
    });
  });

  describe("UNIQUE 제약 충돌 처리", () => {
    // 동일 수신자·견적·알림 유형의 중복 생성 시 Prisma P2002 원본 오류를 전달하는지 확인
    for (const type of ["QUOTE_RECEIVED", "QUOTE_CONFIRMED"] as const) {
      it(`${type} 중복 생성 시 원본 Prisma 오류를 전달한다`, async () => {
        await runRolledBack(async (tx) => {
          const { recipientId, careRequestId, quoteId } = await createTestRequest(tx);

          const data = {
            recipientId,
            careRequestId,
            quoteId,
            type,
            message: "테스트 알림",
          };

          await tx.notification.create({ data });

          await assert.rejects(tx.notification.create({ data }), assertP2002);
        });
      });
    }

    // 동일 수신자·지정 요청·알림 유형의 중복 생성 시 Prisma P2002 원본 오류를 전달하는지 확인
    for (const type of ["DESIGNATED_REQUEST_RECEIVED", "DESIGNATED_REQUEST_REJECTED"] as const) {
      it(`${type} 중복 생성 시 원본 Prisma 오류를 전달한다`, async () => {
        await runRolledBack(async (tx) => {
          const { recipientId, careRequestId, designatedRequestId } = await createTestRequest(tx);

          const data = {
            recipientId,
            careRequestId,
            designatedRequestId,
            type,
            message: "테스트 알림",
          };

          await tx.notification.create({ data });

          await assert.rejects(tx.notification.create({ data }), assertP2002);
        });
      });
    }

    // 동일 수신자·리뷰·알림 유형의 중복 생성 시 Prisma P2002 원본 오류를 전달하는지 확인
    it("REVIEW_RECEIVED 중복 생성 시 원본 Prisma 오류를 전달한다", async () => {
      await runRolledBack(async (tx) => {
        const { recipientId, careRequestId, reviewId } = await createTestRequest(tx);

        const data = {
          recipientId,
          careRequestId,
          reviewId,
          type: "REVIEW_RECEIVED" as const,
          message: "테스트 알림",
        };

        await tx.notification.create({ data });

        await assert.rejects(tx.notification.create({ data }), assertP2002);
      });
    });

    // 동일 수신자·돌봄 요청·알림 유형의 중복 생성 시 Prisma P2002 원본 오류를 전달하는지 확인
    for (const type of [
      "OWNER_CARE_STARTED",
      "OWNER_CARE_ENDING",
      "REVIEW_AVAILABLE",
      "CARE_REQUEST_EXPIRING",
      "CARE_REQUEST_CANCELED",
      "CARE_REQUEST_EXPIRED",
      "SITTER_CARE_STARTED",
      "SITTER_CARE_ENDING",
    ] as const) {
      it(`${type} 중복 생성 시 원본 Prisma 오류를 전달한다`, async () => {
        await runRolledBack(async (tx) => {
          const { recipientId, careRequestId } = await createTestRequest(tx);

          const data = {
            recipientId,
            careRequestId,
            type,
            message: "테스트 알림",
          };

          await tx.notification.create({ data });

          await assert.rejects(tx.notification.create({ data }), assertP2002);
        });
      });
    }

    // 동일 견적에 서로 다른 단발성 알림 유형은 각각 생성할 수 있는지 확인
    it("동일 견적의 서로 다른 알림 유형은 각각 생성할 수 있다", async () => {
      await runRolledBack(async (tx) => {
        const { recipientId, careRequestId, quoteId } = await createTestRequest(tx);

        for (const type of ["QUOTE_RECEIVED", "QUOTE_CONFIRMED"] as const) {
          await tx.notification.create({
            data: {
              recipientId,
              careRequestId,
              quoteId,
              type,
              message: "테스트 알림",
            },
          });
        }

        assert.equal(
          await tx.notification.count({
            where: { recipientId, quoteId },
          }),
          2,
        );
      });
    });

    // 반복 알림은 부분 UNIQUE 제약 대상에서 제외되어 동일 견적에 여러 번 생성 가능한지 확인
    it("QUOTE_UPDATED는 동일 견적에 반복 생성할 수 있다", async () => {
      await runRolledBack(async (tx) => {
        const { recipientId, careRequestId, quoteId } = await createTestRequest(tx);

        const data = {
          recipientId,
          careRequestId,
          quoteId,
          type: "QUOTE_UPDATED" as const,
          message: "견적이 수정되었습니다.",
        };

        await tx.notification.create({ data });
        await tx.notification.create({ data });

        assert.equal(
          await tx.notification.count({
            where: { recipientId, quoteId, type: "QUOTE_UPDATED" },
          }),
          2,
        );
      });
    });
  });

  describe("FK 제약 검증", () => {
    // 선택 FK를 입력하지 않아도 돌봄 요청 기반 알림을 생성하고 기본값을 유지하는지 확인
    it("선택 FK가 NULL이어도 알림을 생성하고 기본값을 유지한다", async () => {
      await runRolledBack(async (tx) => {
        const { recipientId, careRequestId } = await createTestRequest(tx);

        const notification = await tx.notification.create({
          data: {
            recipientId,
            careRequestId,
            type: "CARE_REQUEST_CANCELED",
            message: "돌봄 요청이 취소되었습니다.",
          },
        });

        assert.equal(notification.quoteId, null);
        assert.equal(notification.designatedRequestId, null);
        assert.equal(notification.reviewId, null);
        assert.equal(notification.readAt, null);
        assert.ok(notification.createdAt instanceof Date);
      });
    });

    // 존재하지 않는 수신자 ID를 참조하면 Prisma P2003 원본 오류를 전달하는지 확인
    it("존재하지 않는 수신자 ID는 원본 Prisma 오류를 전달한다", async () => {
      await runRolledBack(async (tx) => {
        const { careRequestId } = await createTestRequest(tx);

        await assert.rejects(
          tx.notification.create({
            data: {
              recipientId: -1n,
              careRequestId,
              type: "CARE_REQUEST_CANCELED",
              message: "테스트 알림",
            },
          }),
          assertP2003,
        );
      });
    });

    // 존재하지 않는 돌봄 요청 ID를 참조하면 Prisma P2003 원본 오류를 전달하는지 확인
    it("존재하지 않는 돌봄 요청 ID는 원본 Prisma 오류를 전달한다", async () => {
      await runRolledBack(async (tx) => {
        const { recipientId } = await createTestRequest(tx);

        await assert.rejects(
          tx.notification.create({
            data: {
              recipientId,
              careRequestId: -1n,
              type: "CARE_REQUEST_CANCELED",
              message: "테스트 알림",
            },
          }),
          assertP2003,
        );
      });
    });

    // 존재하지 않는 선택 FK 대상에 대해 Prisma P2003 원본 오류를 전달하는지 확인
    for (const field of ["quoteId", "designatedRequestId", "reviewId"] as const) {
      it(`존재하지 않는 ${field}는 원본 Prisma 오류를 전달한다`, async () => {
        await runRolledBack(async (tx) => {
          const { recipientId, careRequestId } = await createTestRequest(tx);

          await assert.rejects(
            tx.notification.create({
              data: {
                recipientId,
                careRequestId,
                [field]: -1n,
                type: "QUOTE_UPDATED",
                message: "테스트 알림",
              },
            }),
            assertP2003,
          );
        });
      });
    }
  });

  describe("도메인 오류 정의", () => {
    // 알림이 존재하지 않는 경우 코드·메시지·HTTP 상태 코드가 명세와 일치하는지 확인
    it("NOTIFICATION_NOT_FOUND는 404 도메인 오류를 반환한다", () => {
      const error = new AppError("NOTIFICATION_NOT_FOUND");

      assert.equal(error.code, "NOTIFICATION_NOT_FOUND");
      assert.equal(error.message, "알림을 찾을 수 없습니다.");
      assert.equal(error.statusCode, 404);

      assert.deepEqual(ERROR_DEFINITIONS.NOTIFICATION_NOT_FOUND, {
        code: "NOTIFICATION_NOT_FOUND",
        message: "알림을 찾을 수 없습니다.",
        statusCode: 404,
      });
    });
  });
});
