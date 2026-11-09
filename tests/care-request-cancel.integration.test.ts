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

      assert.equal(succeeded[0].value.canceledAt.getTime(), savedRequest.canceledAt.getTime());
    });

    // 취소와 견적 확정의 실행 순서를 각각 고정하여 하나의 상태 변경만 허용하는지 확인
    for (const firstOperation of ["CANCEL", "CONFIRM"] as const) {
      it(`돌봄 요청 취소와 견적 확정이 동시에 실행되면 ${firstOperation} 우선 처리 결과를 유지한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createTestRequest();
        const quote = await createTestQuote(careRequestId, sitterId);

        const cancel = (runTransaction: TransactionRunner) =>
          cancelCareRequestService(ownerId, careRequestId, runTransaction);

        const confirm = (runTransaction: TransactionRunner) =>
          confirmQuoteService(ownerId, quote.id, runTransaction);

        const [firstResult, secondResult] =
          firstOperation === "CANCEL"
            ? await runWithOrderedTransactions(cancel, confirm)
            : await runWithOrderedTransactions(confirm, cancel);

        assert.equal(firstResult.status, "fulfilled");
        assert.equal(secondResult.status, "rejected");
        assert.ok(assertAppError("CARE_REQUEST_NOT_FOUND", 404)(secondResult.reason));

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        if (firstOperation === "CANCEL") {
          assert.equal(savedRequest.status, "CANCELED");
          assert.ok(savedRequest.canceledAt instanceof Date);
          assert.equal(savedRequest.confirmedQuoteId, null);
        } else {
          assert.equal(savedRequest.status, "MATCHED");
          assert.equal(savedRequest.confirmedQuoteId, quote.id);
          assert.equal(savedRequest.canceledAt, null);
        }

        assert.equal(await prisma.quote.count({ where: { careRequestId } }), 1);
      });
    }

    // 취소와 견적 생성의 실행 순서를 각각 고정하여 견적 생성 가능 여부를 확인
    for (const firstOperation of ["CANCEL", "CREATE"] as const) {
      it(`돌봄 요청 취소와 견적 생성이 동시에 실행되면 ${firstOperation} 우선 처리 결과를 유지한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createTestRequest();

        const cancel = (runTransaction: TransactionRunner) =>
          cancelCareRequestService(ownerId, careRequestId, runTransaction);

        const create = (runTransaction: TransactionRunner) =>
          createQuote(
            sitterId,
            careRequestId,
            15000,
            "취소와 동시에 제출하는 테스트 견적입니다.",
            runTransaction,
          );

        const [firstResult, secondResult] =
          firstOperation === "CANCEL"
            ? await runWithOrderedTransactions(cancel, create)
            : await runWithOrderedTransactions(create, cancel);

        assert.equal(firstResult.status, "fulfilled");

        if (firstOperation === "CANCEL") {
          assert.equal(secondResult.status, "rejected");
          assert.ok(assertAppError("QUOTE_EDIT_NOT_ALLOWED")(secondResult.reason));
        } else {
          assert.equal(secondResult.status, "fulfilled");
        }

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        const quotes = await prisma.quote.findMany({
          where: { careRequestId },
        });

        assert.equal(savedRequest.status, "CANCELED");
        assert.ok(savedRequest.canceledAt instanceof Date);
        assert.equal(quotes.length, firstOperation === "CREATE" ? 1 : 0);

        if (firstOperation === "CREATE") {
          assert.equal(firstResult.status, "fulfilled");
          assert.ok("careRequestId" in firstResult.value);
          assert.equal(firstResult.value.careRequestId, careRequestId);
          assert.equal(quotes[0].careRequestId, careRequestId);
        }
      });
    }

    // 취소와 견적 수정의 실행 순서를 각각 고정하여 견적 수정 가능 여부를 확인
    for (const firstOperation of ["CANCEL", "UPDATE"] as const) {
      it(`돌봄 요청 취소와 견적 수정이 동시에 실행되면 ${firstOperation} 우선 처리 결과를 유지한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createTestRequest();
        const quote = await createTestQuote(careRequestId, sitterId);

        const cancel = (runTransaction: TransactionRunner) =>
          cancelCareRequestService(ownerId, careRequestId, runTransaction);

        const update = (runTransaction: TransactionRunner) =>
          updateQuoteService(sitterId, quote.id, { price: 25000 }, runTransaction);

        const [firstResult, secondResult] =
          firstOperation === "CANCEL"
            ? await runWithOrderedTransactions(cancel, update)
            : await runWithOrderedTransactions(update, cancel);

        assert.equal(firstResult.status, "fulfilled");

        if (firstOperation === "CANCEL") {
          assert.equal(secondResult.status, "rejected");
          assert.ok(assertAppError("QUOTE_EDIT_NOT_ALLOWED")(secondResult.reason));
        } else {
          assert.equal(secondResult.status, "fulfilled");
        }

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        const savedQuote = await prisma.quote.findUniqueOrThrow({
          where: { id: quote.id },
        });

        assert.equal(savedRequest.status, "CANCELED");
        assert.ok(savedRequest.canceledAt instanceof Date);
        assert.equal(savedQuote.price, firstOperation === "UPDATE" ? 25000 : quote.price);
      });
    }

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
