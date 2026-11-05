import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { updateQuoteService } from "../src/services/quote-service.js";
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
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `quote-update-owner-${uniqueId}@example.com`,
      nickname: `quote-update-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `quote-update-sitter-${uniqueId}@example.com`,
      nickname: `quote-update-sitter-${uniqueId}`,
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
  });

  const request = await prisma.careRequest.create({
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

  const quote = await prisma.quote.create({
    data: {
      careRequestId: request.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 10000,
      comment: "수정 전 테스트용 견적 내용입니다.",
    },
  });

  return {
    careRequestId: request.id,
    sitterId: sitter.id,
    quoteId: quote.id,
    originalQuote: quote,
  };
}

describe("견적 수정", () => {
  describe("동시성 및 트랜잭션", () => {
    // 견적 수정 후 트랜잭션이 실패하면 금액·내용 변경이 모두 롤백되는지 확인
    it("트랜잭션 실패 시 견적 수정을 롤백한다", async () => {
      const { sitterId, quoteId, originalQuote } = await createTestRequest();
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        updateQuoteService(
          sitterId,
          quoteId,
          { price: 25000, comment: "수정 후 테스트용 견적 내용입니다." },
          runTransaction,
        ),
        (error: unknown) => error === transactionError,
      );

      const savedQuote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });

      assert.equal(savedQuote.price, originalQuote.price);
      assert.equal(savedQuote.comment, originalQuote.comment);
      assert.equal(savedQuote.updatedAt.getTime(), originalQuote.updatedAt.getTime());
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 돌봄 요청 상태가 변경됐다면 견적 수정 불가 도메인 오류로 변환하는지 확인
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`P2025 이후 최초 요청이 ${status} 상태면 견적 수정 불가 오류를 반환한다`, async () => {
        const { sitterId, careRequestId, quoteId, originalQuote } = await createTestRequest();

        const runTransaction = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });
          throw createP2025Error();
        };

        await assert.rejects(
          updateQuoteService(sitterId, quoteId, { price: 25000 }, runTransaction),
          assertAppError("QUOTE_EDIT_NOT_ALLOWED"),
        );

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });
        const savedQuote = await prisma.quote.findUniqueOrThrow({
          where: { id: quoteId },
        });
        assert.equal(savedRequest.status, status);
        assert.equal(savedQuote.price, originalQuote.price);
        assert.equal(savedQuote.comment, originalQuote.comment);
      });
    }

    // P2025 이후 돌봄 요청이 OPEN 상태면 원본 Prisma 오류를 전달하고 견적을 수정하지 않는지 확인
    it("P2025 이후 최초 요청이 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, careRequestId, quoteId, originalQuote } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(
        updateQuoteService(sitterId, quoteId, { price: 25000 }, runTransaction),
        assertP2025,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });
      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: { id: quoteId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedQuote.price, originalQuote.price);
      assert.equal(savedQuote.comment, originalQuote.comment);
    });
  });
});
