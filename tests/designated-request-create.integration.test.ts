import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { createDesignatedRequest } from "../src/services/designated-request-service.js";
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

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: {
      driverAdapterError: {
        cause: {
          constraint: {
            index: constraintName,
          },
        },
      },
    },
  });
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest(sitterCount = 4) {
  const uniqueId = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `designated-owner-${uniqueId}@example.com`,
      nickname: `designated-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
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
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  const sitters = await Promise.all(
    Array.from({ length: sitterCount }, (_, index) =>
      prisma.user.create({
        data: {
          email: `designated-sitter-${index}-${uniqueId}@example.com`,
          nickname: `designated-sitter-${index}-${uniqueId}`,
          passwordHash: "test-only",
          role: "SITTER",
        },
      }),
    ),
  );

  return { ownerId: owner.id, careRequestId: request.id, sitterIds: sitters.map((s) => s.id) };
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

describe("지정 요청 생성", () => {
  describe("생성 조건", () => {
    // 정상 생성 후 동일 팟트너에게 중복 지정할 수 없는지 확인
    it("지정 요청을 생성하고 동일 팟트너의 중복 지정을 차단한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      const createdRequest = await createDesignatedRequest(ownerId, careRequestId, sitterId);

      assert.equal(createdRequest.careRequestId, careRequestId);
      assert.equal(createdRequest.sitterId, sitterId);

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterId),
        assertAppError("DESIGNATED_REQUEST_ALREADY_EXISTS"),
      );

      const savedRequests = await prisma.designatedRequest.findMany({
        where: { careRequestId, sitterId },
      });

      assert.equal(savedRequests.length, 1);
      assert.equal(savedRequests[0].id, createdRequest.id);
    });

    // 견적을 제출한 팟트너에게 지정 요청을 생성할 수 없는지 확인
    it("이미 Quote를 보낸 팟트너의 지정을 차단한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      await prisma.quote.create({
        data: {
          careRequestId,
          sitterId,
          type: "GENERAL",
          price: 10000,
          comment: "테스트용 일반 견적입니다.",
        },
      });

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterId),
        assertAppError("SITTER_ALREADY_SENT_QUOTE"),
      );

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 0);
    });

    // 반려된 지정 요청도 누적 3건 제한에 포함되는지 확인
    it("반려된 요청을 포함하여 최대 3건만 지정한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();

      for (const sitterId of sitterIds.slice(0, 3)) {
        await createDesignatedRequest(ownerId, careRequestId, sitterId);
      }

      const firstRequest = await prisma.designatedRequest.findUniqueOrThrow({
        where: { careRequestId_sitterId: { careRequestId, sitterId: sitterIds[0] } },
      });

      await prisma.rejectedRequest.create({
        data: {
          designatedRequestId: firstRequest.id,
          reason: "테스트용 지정 요청 반려 사유입니다.",
        },
      });

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterIds[3]),
        assertAppError("DESIGNATED_REQUEST_LIMIT_EXCEEDED"),
      );

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 3);
    });

    // 공개 요청 숨김 및 서비스 가능 지역이 지정 요청을 제한하지 않는지 확인
    it("공개 요청을 숨긴 팟트너에게도 지역과 무관하게 지정한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      await prisma.ignoredRequest.create({ data: { careRequestId, sitterId } });

      const createdRequest = await createDesignatedRequest(ownerId, careRequestId, sitterId);

      assert.equal(createdRequest.sitterId, sitterId);
      assert.equal(await prisma.ignoredRequest.count({ where: { careRequestId, sitterId } }), 1);
      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId, sitterId } }), 1);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 서로 다른 팟트너의 동시 요청에도 누적 3건 제한을 유지하는지 확인
    it("동시 지정 요청 시 최대 3건 제한을 유지한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();

      const results = await Promise.allSettled(
        sitterIds.map((sitterId) => createDesignatedRequest(ownerId, careRequestId, sitterId)),
      );

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 3);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("DESIGNATED_REQUEST_LIMIT_EXCEEDED")(rejected[0].reason));
      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 3);
    });

    // 동일 팟트너의 동시 요청은 한 건만 저장하는지 확인
    it("동일 팟트너 동시 지정 시 중복 생성을 방지한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      const results = await Promise.allSettled([
        createDesignatedRequest(ownerId, careRequestId, sitterId),
        createDesignatedRequest(ownerId, careRequestId, sitterId),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("DESIGNATED_REQUEST_ALREADY_EXISTS")(rejected[0].reason));
      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId, sitterId } }), 1);
    });

    // 트랜잭션 중간 실패 시 생성된 지정 요청이 롤백되는지 확인
    it("트랜잭션 실패 시 지정 요청 생성을 롤백한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterId, runTransaction),
        (error: unknown) => error === transactionError,
      );

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId, sitterId } }), 0);
    });
  });

  describe("UNIQUE 제약 충돌 처리", () => {
    // P2002 지정 요청 복합 UNIQUE 제약 충돌 시 중복 지정 도메인 오류 변환 확인
    it("P2002 지정 요청 복합 UNIQUE 충돌은 중복 지정 오류로 변환한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const runTransaction = async () => {
        throw createP2002Error("DesignatedRequest_careRequestId_sitterId_key");
      };

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterIds[0], runTransaction),
        assertAppError("DESIGNATED_REQUEST_ALREADY_EXISTS"),
      );

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 0);
    });

    // P2002 다른 UNIQUE 제약 충돌 시 원본 Prisma 오류 유지 확인
    it("P2002 다른 UNIQUE 제약 충돌은 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const runTransaction = async () => {
        throw createP2002Error("User_email_role_key");
      };

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterIds[0], runTransaction),
        assertP2002,
      );

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 0);
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 최초 요청 상태가 변경됐다면 활성 요청 없음 도메인 오류로 변환
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`P2025 이후 최초 요청이 ${status} 상태면 지정 요청을 차단한다`, async () => {
        const { ownerId, careRequestId, sitterIds } = await createTestRequest();
        const sitterId = sitterIds[0];

        const runTransaction = async () => {
          await prisma.careRequest.update({ where: { id: careRequestId }, data: { status } });
          throw createP2025Error();
        };

        await assert.rejects(
          createDesignatedRequest(ownerId, careRequestId, sitterId, runTransaction),
          assertAppError("ACTIVE_CARE_REQUEST_NOT_FOUND"),
        );

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        assert.equal(savedRequest.status, status);
        assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 0);
      });
    }

    // P2025 이후 최초 요청이 OPEN 상태면 원본 Prisma 오류 유지 확인
    it("P2025 이후 최초 요청이 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterIds[0], runTransaction),
        assertP2025,
      );

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 0);
    });

    // P2025 이후 최초 요청이 삭제되면 원본 Prisma 오류 유지 확인
    it("P2025 이후 최초 요청이 삭제되면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const runTransaction = async () => {
        await prisma.careRequest.delete({ where: { id: careRequestId } });
        throw createP2025Error();
      };

      await assert.rejects(
        createDesignatedRequest(ownerId, careRequestId, sitterIds[0], runTransaction),
        assertP2025,
      );

      assert.equal(await prisma.careRequest.findUnique({ where: { id: careRequestId } }), null);
    });
  });
});
