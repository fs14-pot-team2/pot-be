import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { rejectDesignatedRequest } from "../src/services/designated-request-service.js";
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

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest(startDate = futureDate(7), createSitterProfile = true) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `reject-owner-${uniqueId}@example.com`,
      nickname: `reject-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `reject-sitter-${uniqueId}@example.com`,
      nickname: `reject-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
      ...(createSitterProfile && {
        sitterProfile: {
          create: {
            gender: "FEMALE",
            shortIntroduction: "테스트용 팟트너",
          },
        },
      }),
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
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  const designatedRequest = await prisma.designatedRequest.create({
    data: {
      careRequestId: request.id,
      sitterId: sitter.id,
    },
  });

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: request.id,
    designatedRequestId: designatedRequest.id,
  };
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

const rejectionReason = "해당 일정에는 방문이 어려워 반려합니다.";

describe("지정 요청 반려", () => {
  describe("반려 조건", () => {
    // 정상 반려 결과가 저장되고 기존 지정 요청과 누적 지정 횟수가 유지되는지 확인
    it("지정 요청을 반려하고 기존 지정 요청을 유지한다", async () => {
      const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

      const createdRejection = await rejectDesignatedRequest(
        sitterId,
        designatedRequestId,
        rejectionReason,
      );

      assert.equal(createdRejection.designatedRequestId, designatedRequestId);
      assert.equal(createdRejection.reason, rejectionReason);

      const savedRejection = await prisma.rejectedRequest.findUniqueOrThrow({
        where: { designatedRequestId },
      });

      assert.equal(savedRejection.id, createdRejection.id);
      assert.equal(savedRejection.reason, rejectionReason);

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId } }), 1);
    });

    // 동일 지정 요청을 이미 반려한 경우 추가 반려 이력을 생성하지 않는지 확인
    it("이미 반려된 지정 요청의 중복 반려를 차단한다", async () => {
      const { sitterId, designatedRequestId } = await createTestRequest();

      await rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason);

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
        assertAppError("DESIGNATED_REQUEST_ALREADY_REJECTED"),
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 1);
    });

    // 존재하지 않는 지정 요청을 반려할 수 없는지 확인
    it("존재하지 않는 지정 요청의 반려를 차단한다", async () => {
      const { sitterId } = await createTestRequest();

      await assert.rejects(
        rejectDesignatedRequest(sitterId, 0n, rejectionReason),
        assertAppError("DESIGNATED_REQUEST_NOT_FOUND", 404),
      );
    });

    // 지정 요청을 받지 않은 팟트너의 반려를 차단하는지 확인
    it("다른 팟트너의 지정 요청 반려를 차단한다", async () => {
      const { designatedRequestId } = await createTestRequest();
      const { sitterId } = await createTestRequest();

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
        assertAppError("FORBIDDEN", 403),
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // 팟트너 프로필이 없는 경우 반려 이력을 생성하지 않는지 확인
    it("팟트너 프로필이 없으면 지정 요청 반려를 차단한다", async () => {
      const { sitterId, designatedRequestId } = await createTestRequest(futureDate(7), false);

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
        assertAppError("FORBIDDEN", 403),
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // 견적을 제출한 팟트너의 반려를 차단하는지 확인
    it("이미 Quote를 보낸 팟트너의 반려를 차단한다", async () => {
      const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

      await prisma.quote.create({
        data: {
          careRequestId,
          sitterId,
          type: "DESIGNATED",
          price: 10000,
          comment: "테스트용 지정 견적입니다.",
        },
      });

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
        assertAppError("QUOTE_ALREADY_EXISTS"),
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // 비활성 돌봄 요청에서는 지정 요청 반려를 차단하는지 확인
    for (const status of ["MATCHED", "CANCELED", "EXPIRED"] as const) {
      it(`${status} 상태의 돌봄 요청은 지정 요청 반려를 차단한다`, async () => {
        const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: { status },
        });

        await assert.rejects(
          rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
          assertAppError("CARE_REQUEST_NOT_FOUND", 404),
        );

        assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
      });
    }

    // 만료 처리 결과가 롤백되지 않고 EXPIRED로 커밋되는지 확인
    it("시작일이 지난 요청은 만료 처리 후 반려를 차단한다", async () => {
      const { sitterId, careRequestId, designatedRequestId } = await createTestRequest(
        futureDate(-1),
      );

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
        assertAppError("CARE_REQUEST_NOT_FOUND", 404),
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 동일 지정 요청을 동시에 반려해도 반려 이력이 한 건만 생성되는지 확인
    it("동일 지정 요청의 동시 반려 시 중복 생성을 방지한다", async () => {
      const { ownerId, sitterId, careRequestId, designatedRequestId } = await createTestRequest();

      const results = await Promise.allSettled([
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("DESIGNATED_REQUEST_ALREADY_REJECTED")(rejected[0].reason));

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 1);

      const notifications = await prisma.notification.findMany({
        where: {
          careRequestId,
          designatedRequestId,
          type: "DESIGNATED_REQUEST_REJECTED",
        },
      });

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipientId, ownerId);
    });

    // 반려 이력 생성 이후 트랜잭션 실패 시 저장 결과가 롤백되는지 확인
    it("트랜잭션 실패 시 지정 요청 반려를 롤백한다", async () => {
      const { sitterId, designatedRequestId } = await createTestRequest();
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        (error: unknown) => error === transactionError,
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // 동일 트랜잭션에서 견적을 먼저 생성한 뒤 반려 시 기존 견적을 확인하여 차단하는지 확인
    it("견적 생성 이후 지정 요청 반려를 차단한다", async () => {
      const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
        return prisma.$transaction(async (tx) => {
          await tx.quote.create({
            data: {
              careRequestId,
              sitterId,
              type: "DESIGNATED",
              price: 10000,
              comment: "테스트용 지정 견적입니다.",
            },
          });

          return callback(tx);
        });
      };

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        assertAppError("QUOTE_ALREADY_EXISTS"),
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });
  });

  describe("UNIQUE 제약 충돌 처리", () => {
    // P2002 반려 이력 UNIQUE 제약 충돌 시 중복 반려 도메인 오류 변환 확인
    it("P2002 발생 시 중복 반려 오류를 반환한다", async () => {
      const { sitterId, designatedRequestId } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2002Error("RejectedRequest_designatedRequestId_key");
      };

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        assertAppError("DESIGNATED_REQUEST_ALREADY_REJECTED"),
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // P2002 다른 UNIQUE 제약 충돌 시 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 다른 UNIQUE 제약이면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, designatedRequestId } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2002Error("User_email_role_key");
      };

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        assertP2002,
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // P2002 UNIQUE 제약 이름을 식별할 수 없으면 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 UNIQUE 제약 이름이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, designatedRequestId } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2002Error();
      };

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        assertP2002,
      );

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 돌봄 요청 상태가 변경됐다면 반려 불가 도메인 오류로 변환하는지 확인
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`P2025 이후 돌봄 요청이 ${status} 상태면 반려 불가 오류를 반환한다`, async () => {
        const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

        const runTransaction = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });

          throw createP2025Error();
        };

        await assert.rejects(
          rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
          assertAppError("CARE_REQUEST_NOT_FOUND", 404),
        );

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        assert.equal(savedRequest.status, status);

        assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
      });
    }

    // P2025 이후 돌봄 요청이 OPEN 상태면 원본 Prisma 오류 유지 확인
    it("P2025 이후 돌봄 요청이 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        assertP2025,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });

    // P2025 이후 돌봄 요청이 삭제되면 원본 Prisma 오류 유지 확인
    it("P2025 이후 돌봄 요청이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, careRequestId, designatedRequestId } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.designatedRequest.delete({
          where: { id: designatedRequestId },
        });

        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });

        throw createP2025Error();
      };

      await assert.rejects(
        rejectDesignatedRequest(sitterId, designatedRequestId, rejectionReason, runTransaction),
        assertP2025,
      );

      assert.equal(await prisma.careRequest.findUnique({ where: { id: careRequestId } }), null);

      assert.equal(await prisma.rejectedRequest.count({ where: { designatedRequestId } }), 0);
    });
  });
});
