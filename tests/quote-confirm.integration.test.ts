import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { confirmQuoteService, updateQuoteService } from "../src/services/quote-service.js";
import type { TransactionRunner } from "../src/types/db.js";
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

// 첫 번째 트랜잭션의 커밋을 보류하고 두 번째 트랜잭션이 시작된 후 완료
async function runWithOrderedTransactions<TFirst, TSecond>(
  firstOperation: (runTransaction: TransactionRunner) => Promise<TFirst>,
  secondOperation: (runTransaction: TransactionRunner) => Promise<TSecond>,
): Promise<[PromiseSettledResult<TFirst>, PromiseSettledResult<TSecond>]> {
  let notifyFirstReady!: () => void;
  let notifySecondStarted!: () => void;
  let releaseFirstCommit!: () => void;

  const firstReady = new Promise<void>((resolve) => {
    notifyFirstReady = resolve;
  });

  const secondStarted = new Promise<void>((resolve) => {
    notifySecondStarted = resolve;
  });

  const firstCommitAllowed = new Promise<void>((resolve) => {
    releaseFirstCommit = resolve;
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
      notifySecondStarted();
      return callback(tx);
    });

  const firstResult = firstOperation(firstRunner);
  let secondResult: Promise<TSecond> | undefined;

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

    secondResult = secondOperation(secondRunner);

    await Promise.race([
      secondStarted,
      secondResult.then(
        () => {
          throw new Error("두 번째 트랜잭션이 예상보다 먼저 종료되었습니다.");
        },
        (error: unknown) => {
          throw error;
        },
      ),
    ]);
  } finally {
    releaseFirstCommit();
  }

  assert.ok(secondResult);
  return Promise.allSettled([firstResult, secondResult]);
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

    // 견적 수정과 확정의 실행 순서를 각각 고정하여 수정 가능 여부를 확인
    for (const firstOperation of ["UPDATE", "CONFIRM"] as const) {
      it(`견적 수정과 확정이 동시에 실행되면 ${firstOperation} 우선 처리 결과를 유지한다`, async () => {
        const { ownerId, careRequestId, sitterIds, quoteIds, originalQuotes } =
          await createTestRequest();
        const quoteId = quoteIds[0];

        const update = (runTransaction: TransactionRunner) =>
          updateQuoteService(sitterIds[0], quoteId, { price: 25000 }, runTransaction);

        const confirm = (runTransaction: TransactionRunner) =>
          confirmQuoteService(ownerId, quoteId, runTransaction);

        const [firstResult, secondResult] =
          firstOperation === "UPDATE"
            ? await runWithOrderedTransactions(update, confirm)
            : await runWithOrderedTransactions(confirm, update);

        assert.equal(firstResult.status, "fulfilled");

        if (firstOperation === "UPDATE") {
          assert.ok("price" in firstResult.value);
          assert.equal(firstResult.value.price, 25000);

          assert.equal(secondResult.status, "fulfilled");
          assert.ok("careRequest" in secondResult.value);
          assert.equal(secondResult.value.careRequest.status, "MATCHED");
          assert.equal(secondResult.value.careRequest.confirmedQuoteId, quoteId);
        } else {
          assert.ok("careRequest" in firstResult.value);
          assert.equal(firstResult.value.careRequest.status, "MATCHED");
          assert.equal(firstResult.value.careRequest.confirmedQuoteId, quoteId);

          assert.equal(secondResult.status, "rejected");
          assert.ok(assertAppError("QUOTE_EDIT_NOT_ALLOWED")(secondResult.reason));
        }

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        const savedQuote = await prisma.quote.findUniqueOrThrow({
          where: { id: quoteId },
        });

        assert.equal(savedRequest.status, "MATCHED");
        assert.equal(savedRequest.confirmedQuoteId, quoteId);
        assert.equal(
          savedQuote.price,
          firstOperation === "UPDATE" ? 25000 : originalQuotes[0].price,
        );
      });
    }

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
