import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { cancelCareRequest } from "../src/repositories/care-request-repository.js";
import { cancelCareRequestService } from "../src/services/care-request-service.js";
import {
  confirmQuoteService,
  createQuote,
  updateQuoteService,
} from "../src/services/quote-service.js";
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
async function createTestRequest(startDate = futureDate(7)) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `cancel-owner-${uniqueId}@example.com`,
      nickname: `cancel-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `cancel-sitter-${uniqueId}@example.com`,
      nickname: `cancel-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
      sitterProfile: {
        create: {
          gender: "FEMALE",
          shortIntroduction: "테스트용 팟트너",
          sitterServiceRegions: {
            create: [{ region: "SEOUL" }],
          },
        },
      },
    },
  });

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

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: request.id,
  };
}

// 테스트 요청에 기존 견적 생성
async function createTestQuote(careRequestId: bigint, sitterId: bigint) {
  return prisma.quote.create({
    data: {
      careRequestId,
      sitterId,
      type: "GENERAL",
      price: 10000,
      comment: "취소 동시성 검증용 견적 내용입니다.",
    },
  });
}

describe("돌봄 요청 취소", () => {
  describe("동시성 및 트랜잭션", () => {
    // 동일 요청을 동시에 취소해도 한 번만 성공하고 취소 결과를 유지하는지 확인
    it("동일 요청의 동시 취소 시 중복 취소를 방지한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const results = await Promise.allSettled([
        cancelCareRequestService(ownerId, careRequestId),
        cancelCareRequestService(ownerId, careRequestId),
      ]);

      const succeeded = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof cancelCareRequestService>>> =>
          result.status === "fulfilled",
      );

      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("CARE_REQUEST_ALREADY_CANCELED")(rejected[0].reason));

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");
      assert.ok(savedRequest.canceledAt instanceof Date);
      assert.equal(savedRequest.confirmedQuoteId, null);
      assert.ok(succeeded[0].value.canceledAt instanceof Date);
      assert.ok(savedRequest.canceledAt instanceof Date);

      assert.equal(succeeded[0].value.canceledAt.getTime(), savedRequest.canceledAt.getTime());
    });

    // 취소와 견적 확정이 동시에 실행되면 한 상태 변경만 성공하는지 확인
    it("돌봄 요청 취소와 견적 확정이 동시에 실행되면 하나의 상태 변경만 허용한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const quote = await createTestQuote(careRequestId, sitterId);

      const [cancelResult, confirmResult] = await Promise.allSettled([
        cancelCareRequestService(ownerId, careRequestId),
        confirmQuoteService(ownerId, quote.id),
      ]);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      if (cancelResult.status === "fulfilled") {
        assert.equal(confirmResult.status, "rejected");
        assert.ok(assertAppError("CARE_REQUEST_NOT_FOUND", 404)(confirmResult.reason));
        assert.equal(savedRequest.status, "CANCELED");
        assert.ok(savedRequest.canceledAt instanceof Date);
        assert.equal(savedRequest.confirmedQuoteId, null);
      } else {
        assert.equal(confirmResult.status, "fulfilled");
        assert.ok(assertAppError("CARE_REQUEST_NOT_FOUND", 404)(cancelResult.reason));
        assert.equal(savedRequest.status, "MATCHED");
        assert.equal(savedRequest.confirmedQuoteId, quote.id);
        assert.equal(savedRequest.canceledAt, null);
      }

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 1);
    });

    // 견적 생성과 취소가 동시에 실행될 때 취소 상태 이후 견적 생성을 차단하는지 확인
    it("돌봄 요청 취소와 견적 생성이 동시에 실행되면 처리 순서에 따라 생성 여부를 결정한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const [cancelResult, createResult] = await Promise.allSettled([
        cancelCareRequestService(ownerId, careRequestId),
        createQuote(sitterId, careRequestId, 15000, "취소와 동시에 제출하는 테스트 견적입니다."),
      ]);

      assert.equal(cancelResult.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      const quoteCount = await prisma.quote.count({
        where: { careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");
      assert.ok(savedRequest.canceledAt instanceof Date);

      if (createResult.status === "fulfilled") {
        assert.equal(quoteCount, 1);
        assert.equal(createResult.value.careRequestId, careRequestId);
      } else {
        assert.ok(assertAppError("QUOTE_EDIT_NOT_ALLOWED")(createResult.reason));
        assert.equal(quoteCount, 0);
      }
    });

    // 견적 수정과 취소의 잠금 순서에 따라 수정 여부를 결정하는지 확인
    it("돌봄 요청 취소와 견적 수정이 동시에 실행되면 처리 순서에 따라 수정 여부를 결정한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const quote = await createTestQuote(careRequestId, sitterId);

      const [cancelResult, updateResult] = await Promise.allSettled([
        cancelCareRequestService(ownerId, careRequestId),
        updateQuoteService(sitterId, quote.id, { price: 25000 }),
      ]);

      assert.equal(cancelResult.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
      });

      assert.equal(savedRequest.status, "CANCELED");
      assert.ok(savedRequest.canceledAt instanceof Date);

      if (updateResult.status === "fulfilled") {
        assert.equal(savedQuote.price, 25000);
      } else {
        assert.ok(assertAppError("QUOTE_EDIT_NOT_ALLOWED")(updateResult.reason));
        assert.equal(savedQuote.price, quote.price);
      }
    });

    // 취소와 정기 만료 조건의 동시 실행 시 EXPIRED 상태를 유지하는지 확인
    it("만료 대상 요청의 취소와 만료 처리가 동시에 실행되면 취소를 차단한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest(futureDate(-1));

      const [cancelResult, expireResult] = await Promise.allSettled([
        cancelCareRequestService(ownerId, careRequestId),
        prisma.careRequest.updateMany({
          where: {
            id: careRequestId,
            status: "OPEN",
            startDate: { lt: futureDate(0) },
          },
          data: { status: "EXPIRED" },
        }),
      ]);

      assert.equal(cancelResult.status, "rejected");
      assert.ok(assertAppError("CARE_REQUEST_NOT_FOUND", 404)(cancelResult.reason));
      assert.equal(expireResult.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(savedRequest.canceledAt, null);
    });

    // 정상 취소 후 트랜잭션이 커밋되면 상태와 취소 시각이 유지되는지 확인
    it("트랜잭션 성공 시 취소 결과가 DB에 반영된다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      await prisma.$transaction(async (tx) => {
        await cancelCareRequest(careRequestId, ownerId, tx);
      });

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");
      assert.ok(savedRequest.canceledAt instanceof Date);
    });

    // 취소 UPDATE 이후 트랜잭션이 실패하면 상태와 취소 시각을 롤백하는지 확인
    it("트랜잭션 실패 시 취소 결과가 DB에 반영되지 않는다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await cancelCareRequest(careRequestId, ownerId, tx);

          throw new Error("테스트용 트랜잭션 실패");
        }),
        /테스트용 트랜잭션 실패/,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.canceledAt, null);
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 이미 취소된 요청이면 중복 취소 오류로 변환하는지 확인
    it("P2025 이후 CANCELED 상태면 중복 취소 오류를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
          },
        });

        throw createP2025Error();
      };

      await assert.rejects(
        cancelCareRequestService(ownerId, careRequestId, runTransaction),
        assertAppError("CARE_REQUEST_ALREADY_CANCELED"),
      );
    });

    // P2025 이후 MATCHED 또는 EXPIRED 상태면 취소 불가 오류로 변환하는지 확인
    for (const status of ["MATCHED", "EXPIRED"] as const) {
      it(`P2025 이후 ${status} 상태면 취소 불가 오류를 반환한다`, async () => {
        const { ownerId, careRequestId } = await createTestRequest();

        const runTransaction = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });

          throw createP2025Error();
        };

        await assert.rejects(
          cancelCareRequestService(ownerId, careRequestId, runTransaction),
          assertAppError("CARE_REQUEST_NOT_FOUND", 404),
        );
      });
    }

    // P2025 이후 요청 상태가 여전히 OPEN이면 원본 Prisma 오류를 유지하는지 확인
    it("P2025 이후 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(
        cancelCareRequestService(ownerId, careRequestId, runTransaction),
        assertP2025,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.canceledAt, null);
    });

    // P2025 이후 최초 요청이 삭제되면 원본 Prisma 오류를 유지하는지 확인
    it("P2025 이후 요청이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });

        throw createP2025Error();
      };

      await assert.rejects(
        cancelCareRequestService(ownerId, careRequestId, runTransaction),
        assertP2025,
      );

      const deletedRequest = await prisma.careRequest.findUnique({
        where: { id: careRequestId },
      });

      assert.equal(deletedRequest, null);
    });
  });
});
