import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { confirmQuoteService, updateQuoteService } from "../src/services/quote-service.js";
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

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청, 팟트너 및 견적 생성
async function createTestRequest(startDate = futureDate(7)) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `quote-confirm-owner-${uniqueId}@example.com`,
      nickname: `quote-confirm-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitters = await Promise.all(
    Array.from({ length: 2 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `quote-confirm-sitter-${index}-${uniqueId}@example.com`,
          nickname: `quote-confirm-sitter-${index}-${uniqueId}`,
          passwordHash: "test-only",
          role: "SITTER",
          sitterProfile: {
            create: {
              gender: "FEMALE",
              shortIntroduction: "테스트용 팟트너",
              sitterServiceRegions: { create: [{ region: "SEOUL" }] },
            },
          },
        },
      }),
    ),
  );

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate,
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

  const quotes = await Promise.all(
    sitters.map((sitter, index) =>
      prisma.quote.create({
        data: {
          careRequestId: request.id,
          sitterId: sitter.id,
          type: "GENERAL",
          price: 10000 + index * 1000,
          comment: "확정 전 테스트용 견적 내용입니다.",
        },
      }),
    ),
  );

  return {
    ownerId: owner.id,
    careRequestId: request.id,
    sitterIds: sitters.map((sitter) => sitter.id),
    quoteIds: quotes.map((quote) => quote.id),
    originalQuotes: quotes,
  };
}

describe("견적 확정", () => {
  describe("동시성 및 트랜잭션", () => {
    // 동일 견적을 동시에 확정해도 하나만 성공하고 확정 결과를 유지하는지 확인
    it("동일 견적의 동시 확정 시 중복 확정을 방지한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();
      const quoteId = quoteIds[0];

      const results = await Promise.allSettled([
        confirmQuoteService(ownerId, quoteId),
        confirmQuoteService(ownerId, quoteId),
      ]);

      const succeeded = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmQuoteService>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("QUOTE_ALREADY_CONFIRMED")(rejected[0].reason));

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      assert.equal(savedRequest.confirmedQuoteId, quoteId);
      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 2);
    });

    // 서로 다른 견적을 동시에 확정해도 하나만 확정되고 다른 견적은 유지되는지 확인
    it("서로 다른 견적의 동시 확정 시 중복 확정을 방지한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();

      const results = await Promise.allSettled(
        quoteIds.map((quoteId) => confirmQuoteService(ownerId, quoteId)),
      );

      const succeeded = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmQuoteService>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("CARE_REQUEST_ALREADY_MATCHED")(rejected[0].reason));

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      assert.equal(savedRequest.confirmedQuoteId, succeeded[0].value.quote.id);
      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 2);
    });

    // 견적 수정과 확정이 동시에 실행되면 잠금 순서에 따라 수정 여부를 결정하는지 확인
    it("견적 수정과 확정이 동시에 실행되면 처리 순서에 따라 수정 여부를 결정한다", async () => {
      const { ownerId, careRequestId, sitterIds, quoteIds, originalQuotes } =
        await createTestRequest();
      const quoteId = quoteIds[0];

      const [updateResult, confirmResult] = await Promise.allSettled([
        updateQuoteService(sitterIds[0], quoteId, { price: 25000 }),
        confirmQuoteService(ownerId, quoteId),
      ]);

      assert.equal(confirmResult.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });
      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: { id: quoteId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      assert.equal(savedRequest.confirmedQuoteId, quoteId);

      if (updateResult.status === "fulfilled") {
        assert.equal(savedQuote.price, 25000);
      } else {
        assert.ok(assertAppError("QUOTE_EDIT_NOT_ALLOWED")(updateResult.reason));
        assert.equal(savedQuote.price, originalQuotes[0].price);
      }
    });

    // 만료 처리와 확정이 동시에 실행되면 만료 상태를 유지하고 확정을 차단하는지 확인
    it("만료 처리와 견적 확정이 동시에 실행되면 확정을 차단한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest(futureDate(-1));

      const [confirmResult, expireResult] = await Promise.allSettled([
        confirmQuoteService(ownerId, quoteIds[0]),
        prisma.careRequest.updateMany({
          where: {
            id: careRequestId,
            status: "OPEN",
            startDate: { lt: futureDate(0) },
          },
          data: { status: "EXPIRED" },
        }),
      ]);

      assert.equal(confirmResult.status, "rejected");
      assert.ok(assertAppError("CARE_REQUEST_NOT_FOUND", 404)(confirmResult.reason));
      assert.equal(expireResult.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(savedRequest.confirmedQuoteId, null);
      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 2);
    });

    // 확정 처리 이후 트랜잭션이 실패하면 상태와 확정 견적 ID 변경이 롤백되는지 확인
    it("트랜잭션 실패 시 견적 확정을 롤백한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        confirmQuoteService(ownerId, quoteIds[0], runTransaction),
        (error: unknown) => error === transactionError,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.confirmedQuoteId, null);
      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 2);
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 동일 견적이 확정됐다면 동일 견적 재확정 오류로 변환하는지 확인
    it("P2025 이후 동일 견적이 확정되었다면 재확정 오류를 반환한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: {
            status: "MATCHED",
            confirmedQuoteId: quoteIds[0],
          },
        });
        throw createP2025Error();
      };

      await assert.rejects(
        confirmQuoteService(ownerId, quoteIds[0], runTransaction),
        assertAppError("QUOTE_ALREADY_CONFIRMED"),
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      assert.equal(savedRequest.confirmedQuoteId, quoteIds[0]);
    });

    // P2025 이후 다른 견적이 확정됐다면 다른 견적 확정 오류로 변환하는지 확인
    it("P2025 이후 다른 견적이 확정되었다면 중복 확정 오류를 반환한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: {
            status: "MATCHED",
            confirmedQuoteId: quoteIds[1],
          },
        });
        throw createP2025Error();
      };

      await assert.rejects(
        confirmQuoteService(ownerId, quoteIds[0], runTransaction),
        assertAppError("CARE_REQUEST_ALREADY_MATCHED"),
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      assert.equal(savedRequest.confirmedQuoteId, quoteIds[1]);
    });

    // P2025 이후 돌봄 요청이 비활성 상태라면 돌봄 요청 없음 오류로 변환하는지 확인
    for (const status of ["EXPIRED", "CANCELED"] as const) {
      it(`P2025 이후 돌봄 요청이 ${status} 상태면 돌봄 요청 없음 오류를 반환한다`, async () => {
        const { ownerId, careRequestId, quoteIds } = await createTestRequest();

        const runTransaction = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });

          throw createP2025Error();
        };

        await assert.rejects(
          confirmQuoteService(ownerId, quoteIds[0], runTransaction),
          assertAppError("CARE_REQUEST_NOT_FOUND", 404),
        );

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        assert.equal(savedRequest.status, status);
        assert.equal(savedRequest.confirmedQuoteId, null);
      });
    }

    // P2025 이후 돌봄 요청이 OPEN 상태면 원본 Prisma 오류를 전달하는지 확인
    it("P2025 이후 돌봄 요청이 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(confirmQuoteService(ownerId, quoteIds[0], runTransaction), assertP2025);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.confirmedQuoteId, null);
    });

    // P2025 이후 돌봄 요청이 삭제되면 원본 Prisma 오류를 전달하는지 확인
    it("P2025 이후 돌봄 요청이 삭제되면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId, quoteIds } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.quote.deleteMany({
          where: { careRequestId },
        });

        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });

        throw createP2025Error();
      };

      await assert.rejects(confirmQuoteService(ownerId, quoteIds[0], runTransaction), assertP2025);

      assert.equal(
        await prisma.careRequest.findUnique({
          where: { id: careRequestId },
        }),
        null,
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
    });
  });
});
