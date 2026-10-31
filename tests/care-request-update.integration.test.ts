import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "pg";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import {
  lockCareRequestForUpdate,
  updateOpenCareRequest,
} from "../src/repositories/care-request-repository.js";
import { updateCareRequest } from "../src/services/care-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 각 테스트에서 사용할 독립적인 돌봄 요청 생성
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createTestRequest(startDate = futureDate(7)) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `update-test-${uniqueId}@example.com`,
      nickname: `update-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: new Date(`${futureDate(14)}T00:00:00.000Z`),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: "기존 상세 주소",
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  return { ownerId: owner.id, careRequestId: request.id };
}

// Service 에러 코드와 Prisma 충돌 오류 검증에 사용하는 공통 함수
function assertAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

function assertP2025(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2025";
}

function createP2025Error() {
  return Object.assign(new Error("Record not found"), {
    code: "P2025",
  });
}

describe("돌봄 요청 수정", () => {
  describe("부분 수정 및 수정 가능 조건별 처리", () => {
    // 전달한 필드만 수정하고 생략한 필드와 요청 상태 유지 확인
    it("부분 수정 결과가 DB에 저장되고 기존 값은 유지된다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const updatedRequest = await updateCareRequest(ownerId, careRequestId, {
        detailAddress: "수정된 상세 주소",
      });

      assert.equal(updatedRequest.detailAddress, "수정된 상세 주소");
      assert.equal(updatedRequest.address, "서울특별시 중구 세종대로 110");
      assert.equal(updatedRequest.status, "OPEN");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.detailAddress, "수정된 상세 주소");
      assert.equal(savedRequest.address, "서울특별시 중구 세종대로 110");
      assert.equal(savedRequest.status, "OPEN");
    });

    // 수정할 필드가 없는 PATCH 요청 허용 확인
    it("빈 수정 데이터도 정상 처리한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const updatedRequest = await updateCareRequest(ownerId, careRequestId, {});

      assert.equal(updatedRequest.id, careRequestId);
      assert.equal(updatedRequest.status, "OPEN");
    });

    // 수정 불가 상태에 따른 공통 에러 반환 확인
    it("MATCHED, CANCELED, EXPIRED 요청은 수정할 수 없다", async () => {
      for (const status of ["MATCHED", "CANCELED", "EXPIRED"] as const) {
        const { ownerId, careRequestId } = await createTestRequest();

        await prisma.careRequest.update({
          where: { id: careRequestId },
          data: { status },
        });

        await assert.rejects(
          updateCareRequest(ownerId, careRequestId, {
            detailAddress: "수정 시도",
          }),
          assertAppError("CARE_REQUEST_STATUS_NOT_EDITABLE"),
        );
      }
    });

    // 만료 처리 결과가 롤백되지 않고 EXPIRED로 커밋되는지 확인
    it("시작일이 지난 요청은 만료 처리 후 수정을 거부한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest(futureDate(-1));

      await assert.rejects(
        updateCareRequest(ownerId, careRequestId, {
          detailAddress: "수정 시도",
        }),
        assertAppError("CARE_REQUEST_STATUS_NOT_EDITABLE"),
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(savedRequest.detailAddress, "기존 상세 주소");
    });

    // 기존 날짜와 수정 날짜의 조합이 잘못되면 변경 없이 거부하는지 확인
    it("최종 날짜 검증 실패 시 DB 데이터를 변경하지 않는다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      await assert.rejects(
        updateCareRequest(ownerId, careRequestId, {
          endDate: futureDate(3),
        }),
        assertAppError("INVALID_CARE_DATE"),
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.endDate.toISOString().slice(0, 10), futureDate(14));
      assert.equal(savedRequest.detailAddress, "기존 상세 주소");
    });

    // 행 잠금 이후 정상 UPDATE 결과가 커밋되는지 확인
    it("트랜잭션 성공 시 수정 내용이 DB에 반영된다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      await prisma.$transaction(async (tx) => {
        await lockCareRequestForUpdate(careRequestId, tx);

        await updateOpenCareRequest(careRequestId, ownerId, { detailAddress: "커밋 확인" }, tx);
      });

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.detailAddress, "커밋 확인");
    });

    // UPDATE 후 트랜잭션이 실패하면 변경 내용이 롤백되는지 확인
    it("트랜잭션 실패 시 수정 내용이 DB에 반영되지 않는다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await lockCareRequestForUpdate(careRequestId, tx);

          await updateOpenCareRequest(careRequestId, ownerId, { detailAddress: "롤백 대상" }, tx);

          throw new Error("테스트용 트랜잭션 실패");
        }),
        /테스트용 트랜잭션 실패/,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.detailAddress, "기존 상세 주소");
    });

    // FOR UPDATE 잠금이 유지되는 동안 다른 DB 연결의 동일 행 수정이 대기하는지 확인
    it("행 잠금 중 다른 작업의 동일 요청 수정을 대기시킨다", async () => {
      const { careRequestId } = await createTestRequest();

      const connectionString = process.env.DATABASE_URL;
      assert.ok(connectionString, "DATABASE_URL이 필요합니다.");

      const client = new Client({ connectionString });
      await client.connect();

      try {
        await prisma.$transaction(async (tx) => {
          await lockCareRequestForUpdate(careRequestId, tx);

          await client.query("BEGIN");
          await client.query("SET LOCAL lock_timeout = '200ms'");

          try {
            // 대기 시간 초과 오류 55P03으로 행 잠금의 실제 적용 여부 확인
            await assert.rejects(
              client.query(
                `UPDATE "CareRequest"
                 SET "detailAddress" = $1
                 WHERE "id" = $2`,
                ["다른 작업의 수정", careRequestId.toString()],
              ),
              (error: unknown) =>
                error instanceof Error && "code" in error && error.code === "55P03",
            );
          } finally {
            await client.query("ROLLBACK");
          }
        });

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        assert.equal(savedRequest.detailAddress, "기존 상세 주소");
      } finally {
        await client.end();
      }
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 발생 후 최초 요청의 최신 상태에 따른 도메인 에러 변환 확인
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`P2025 이후 ${status} 상태면 수정 불가 에러를 반환한다`, async () => {
        const { ownerId, careRequestId } = await createTestRequest();

        const runTransaction = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });

          throw createP2025Error();
        };

        await assert.rejects(
          updateCareRequest(ownerId, careRequestId, {}, runTransaction),
          assertAppError("CARE_REQUEST_STATUS_NOT_EDITABLE"),
        );
      });
    }

    // P2025 이후에도 상태가 OPEN이면 원래 Prisma 오류를 유지하는지 확인
    it("P2025 이후 OPEN 상태면 기존 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(
        updateCareRequest(ownerId, careRequestId, {}, runTransaction),
        assertP2025,
      );
    });

    // P2025 이후 최초 요청이 사라진 경우에도 기존 오류를 유지하는지 확인
    it("P2025 이후 요청이 없으면 기존 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });

        throw createP2025Error();
      };

      await assert.rejects(
        updateCareRequest(ownerId, careRequestId, {}, runTransaction),
        assertP2025,
      );
    });
  });
});
