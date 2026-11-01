import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { createCareRequest } from "../src/services/care-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName?: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    ...(constraintName && {
      meta: {
        driverAdapterError: {
          cause: {
            constraint: {
              index: constraintName,
            },
          },
        },
      },
    }),
  });
}

// Prisma P2025 충돌 오류 생성
function createP2025Error() {
  return Object.assign(new Error("Record not found"), {
    code: "P2025",
  });
}

// 생성 API 요청에 사용할 공통 데이터
function createRequestData() {
  return {
    serviceType: "SHORT_CARE" as const,
    startDate: futureDate(7),
    endDate: futureDate(14),
    zonecode: "04524",
    address: "서울특별시 중구 세종대로 110",
    detailAddress: null,
    sido: "서울특별시",
    sigungu: "중구",
    bname: null,
    region: "SEOUL" as const,
  };
}

// 각 테스트에서 사용할 독립적인 팟오너와 만료 대상 돌봄 요청 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `create-test-${uniqueId}@example.com`,
      nickname: `create-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      ...createRequestData(),
      startDate: new Date(`${futureDate(-1)}T00:00:00.000Z`),
      endDate: new Date(`${futureDate(7)}T00:00:00.000Z`),
      status: "OPEN",
    },
  });

  return { ownerId: owner.id, careRequestId: request.id };
}

// 최초 OPEN 요청 조회 후 만료 UPDATE에서 P2025가 발생하도록 재현
// 현재 서비스 호출 흐름에 필요한 findFirst/update만 구현한 테스트용 트랜잭션 객체
function createConflictTransaction(
  initialRequest: Awaited<ReturnType<typeof prisma.careRequest.findUniqueOrThrow>>,
) {
  return {
    careRequest: {
      findFirst: async () => initialRequest,
      update: async () => {
        throw createP2025Error();
      },
    },
  } as unknown as Prisma.TransactionClient;
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// Prisma P2002 원본 오류 전달 확인
function assertP2002(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2002" &&
    !(error instanceof AppError)
  );
}

// Prisma P2025 원본 오류 전달 확인
function assertP2025(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2025";
}

describe("돌봄 요청 생성", () => {
  describe("UNIQUE 제약 충돌 처리", () => {
    // P2002 대상 UNIQUE 제약 충돌 시 중복 요청 오류 변환 확인
    it("P2002 발생 시 활성 돌봄 요청 중복 에러를 반환한다", async () => {
      const runTransaction = async () => {
        throw createP2002Error("CareRequest_one_open_per_owner_idx");
      };

      await assert.rejects(
        createCareRequest(1n, createRequestData(), runTransaction),
        assertAppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS"),
      );
    });

    // P2002 다른 UNIQUE 제약 충돌 시 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 다른 UNIQUE 제약이면 원본 Prisma 오류를 전달한다", async () => {
      const runTransaction = async () => {
        throw createP2002Error("User_email_role_key");
      };

      await assert.rejects(createCareRequest(1n, createRequestData(), runTransaction), assertP2002);
    });

    // P2002 UNIQUE 제약 이름을 식별할 수 없으면 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 UNIQUE 제약 이름이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const runTransaction = async () => {
        throw createP2002Error();
      };

      await assert.rejects(createCareRequest(1n, createRequestData(), runTransaction), assertP2002);
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 다른 활성 요청이 있으면 중복 에러를 반환하고 재시도하지 않는지 확인
    it("P2025 이후 다른 활성 요청이 있으면 중복 에러를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const initialRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      let transactionCount = 0;

      const runTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        transactionCount++;

        // 다른 작업이 기존 요청을 만료시키고 새 활성 요청을 생성한 상황 재현
        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: { status: "EXPIRED" },
        });

        await prisma.careRequest.create({
          data: {
            ownerId,
            ...createRequestData(),
            startDate: new Date(`${futureDate(7)}T00:00:00.000Z`),
            endDate: new Date(`${futureDate(14)}T00:00:00.000Z`),
            status: "OPEN",
          },
        });

        return callback(createConflictTransaction(initialRequest));
      };

      await assert.rejects(
        createCareRequest(ownerId, createRequestData(), runTransaction),
        assertAppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS"),
      );

      assert.equal(transactionCount, 1);

      const openRequests = await prisma.careRequest.findMany({
        where: { ownerId, status: "OPEN" },
      });

      assert.equal(openRequests.length, 1);
      assert.notEqual(openRequests[0].id, careRequestId);
    });

    // P2025 이후 활성 요청이 없으면 트랜잭션을 한 번 재시도해 신규 요청을 생성하는지 확인
    it("P2025 이후 활성 요청이 없으면 재시도하여 신규 요청을 생성한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const initialRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      let transactionCount = 0;

      const runTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        transactionCount++;

        if (transactionCount === 1) {
          // 다른 작업이 기존 요청을 만료 처리한 상황 재현
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status: "EXPIRED" },
          });

          return callback(createConflictTransaction(initialRequest));
        }

        // 두 번째 실행은 실제 PostgreSQL 트랜잭션 사용
        return prisma.$transaction(callback);
      };

      const createdRequest = await createCareRequest(ownerId, createRequestData(), runTransaction);

      assert.equal(transactionCount, 2);
      assert.equal(createdRequest.status, "OPEN");
      assert.notEqual(createdRequest.id, careRequestId);

      const previousRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(previousRequest.status, "EXPIRED");

      const openRequests = await prisma.careRequest.findMany({
        where: { ownerId, status: "OPEN" },
      });

      assert.equal(openRequests.length, 1);
      assert.equal(openRequests[0].id, createdRequest.id);
    });

    // P2025 이후 최초 요청이 여전히 OPEN이면 원본 Prisma 오류를 유지하고 재시도하지 않는지 확인
    it("P2025 이후 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const initialRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      let transactionCount = 0;

      const runTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        transactionCount++;
        return callback(createConflictTransaction(initialRequest));
      };

      await assert.rejects(
        createCareRequest(ownerId, createRequestData(), runTransaction),
        assertP2025,
      );

      assert.equal(transactionCount, 1);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
    });

    // P2025 이후 최초 요청이 삭제됐다면 원본 Prisma 오류를 유지하고 재시도하지 않는지 확인
    it("P2025 이후 요청이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const initialRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      let transactionCount = 0;

      const runTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        transactionCount++;

        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });

        return callback(createConflictTransaction(initialRequest));
      };

      await assert.rejects(
        createCareRequest(ownerId, createRequestData(), runTransaction),
        assertP2025,
      );

      assert.equal(transactionCount, 1);

      const deletedRequest = await prisma.careRequest.findUnique({
        where: { id: careRequestId },
      });

      assert.equal(deletedRequest, null);
    });

    // 최초 OPEN 요청 ID를 확보하지 못한 상태에서 P2025가 발생하면 원본 Prisma 오류를 전달하는지 확인
    it("최초 요청 ID 없이 P2025 발생 시 원본 Prisma 오류를 전달한다", async () => {
      let transactionCount = 0;

      const runTransaction = async () => {
        transactionCount++;
        throw createP2025Error();
      };

      await assert.rejects(createCareRequest(1n, createRequestData(), runTransaction), assertP2025);

      assert.equal(transactionCount, 1);
    });

    // 재시도 트랜잭션에서도 P2025가 발생하면 추가 재시도 없이 원본 Prisma 오류를 전달하는지 확인
    it("재시도에서도 P2025 발생 시 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const initialRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      let transactionCount = 0;

      const runTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        transactionCount++;

        if (transactionCount === 1) {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status: "EXPIRED" },
          });

          return callback(createConflictTransaction(initialRequest));
        }

        throw createP2025Error();
      };

      await assert.rejects(
        createCareRequest(ownerId, createRequestData(), runTransaction),
        assertP2025,
      );

      assert.equal(transactionCount, 2);

      const openRequests = await prisma.careRequest.count({
        where: { ownerId, status: "OPEN" },
      });

      assert.equal(openRequests, 0);
    });

    // 재시도 중 P2002가 발생하면 중복 요청 에러로 변환하는지 확인
    it("재시도 중 P2002 발생 시 활성 돌봄 요청 중복 에러를 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const initialRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      let transactionCount = 0;

      const runTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => {
        transactionCount++;

        if (transactionCount === 1) {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status: "EXPIRED" },
          });

          return callback(createConflictTransaction(initialRequest));
        }

        throw createP2002Error("CareRequest_one_open_per_owner_idx");
      };

      await assert.rejects(
        createCareRequest(ownerId, createRequestData(), runTransaction),
        assertAppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS"),
      );

      assert.equal(transactionCount, 2);

      const openRequests = await prisma.careRequest.count({
        where: { ownerId, status: "OPEN" },
      });

      assert.equal(openRequests, 0);
    });
  });
});
