import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { expireCareRequestIfPast } from "../src/services/care-request-expiration.js";
import { getActiveCareRequest } from "../src/services/care-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Prisma P2025 충돌 오류 생성
function createP2025Error() {
  return Object.assign(new Error("Record not found"), {
    code: "P2025",
  });
}

// P2025 오류가 그대로 전달되는지 확인
function assertP2025(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2025";
}

// 각 테스트에서 사용할 독립적인 팟오너와 만료 대상 요청 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `active-test-${uniqueId}@example.com`,
      nickname: `active-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: new Date(`${futureDate(-1)}T00:00:00.000Z`),
      endDate: new Date(`${futureDate(7)}T00:00:00.000Z`),
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

  return { ownerId: owner.id, careRequestId: request.id };
}

// 최초 요청의 상태 변경 후 새로운 활성 요청 생성
async function replaceOpenRequest(ownerId: bigint, careRequestId: bigint, startDate: string) {
  await prisma.careRequest.update({
    where: { id: careRequestId },
    data: { status: "EXPIRED" },
  });

  return prisma.careRequest.create({
    data: {
      ownerId,
      serviceType: "SHORT_CARE",
      startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: new Date(`${futureDate(14)}T00:00:00.000Z`),
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
}

describe("활성 돌봄 요청 조회", () => {
  describe("동시 상태 변경 충돌 복구", () => {
    // 최초 요청의 상태 변경 후 다른 활성 요청이 없으면 null 반환 확인
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`P2025 이후 최초 요청이 ${status} 상태이고 활성 요청이 없으면 null을 반환한다`, async () => {
        const { ownerId, careRequestId } = await createTestRequest();

        const expireCareRequestIfPastFn: typeof expireCareRequestIfPast = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });

          throw createP2025Error();
        };

        const result = await getActiveCareRequest(ownerId, expireCareRequestIfPastFn);

        assert.equal(result, null);

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        assert.equal(savedRequest.status, status);
      });
    }

    // 다른 작업에서 생성된 새로운 유효한 OPEN 요청 반환 확인
    it("P2025 이후 다른 유효한 OPEN 요청이 있으면 해당 요청을 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      let expirationCount = 0;
      let newRequestId: bigint | null = null;

      const expireCareRequestIfPastFn: typeof expireCareRequestIfPast = async (request) => {
        expirationCount++;

        if (expirationCount === 1) {
          const newRequest = await replaceOpenRequest(ownerId, careRequestId, futureDate(7));

          newRequestId = newRequest.id;
          throw createP2025Error();
        }

        return expireCareRequestIfPast(request);
      };

      const result = await getActiveCareRequest(ownerId, expireCareRequestIfPastFn);

      assert.equal(expirationCount, 2);
      assert.ok(result);
      assert.equal(result.id, newRequestId);
      assert.equal(result.status, "OPEN");

      const previousRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(previousRequest.status, "EXPIRED");
    });

    // 새 OPEN 요청도 만료 대상이라면 EXPIRED 처리 후 null 반환 확인
    it("P2025 이후 새 활성 요청도 만료 대상이면 EXPIRED 처리하고 null을 반환한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      let expirationCount = 0;
      let newRequestId: bigint | null = null;

      const expireCareRequestIfPastFn: typeof expireCareRequestIfPast = async (request) => {
        expirationCount++;

        if (expirationCount === 1) {
          const newRequest = await replaceOpenRequest(ownerId, careRequestId, futureDate(-2));

          newRequestId = newRequest.id;
          throw createP2025Error();
        }

        return expireCareRequestIfPast(request);
      };

      const result = await getActiveCareRequest(ownerId, expireCareRequestIfPastFn);

      assert.equal(expirationCount, 2);
      assert.equal(result, null);
      assert.ok(newRequestId !== null);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: newRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
    });

    // 최초 요청이 계속 OPEN인 경우 원래 Prisma 오류 유지 확인
    it("P2025 이후 최초 요청이 OPEN 상태면 기존 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const expireCareRequestIfPastFn: typeof expireCareRequestIfPast = async () => {
        throw createP2025Error();
      };

      await assert.rejects(getActiveCareRequest(ownerId, expireCareRequestIfPastFn), assertP2025);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
    });

    // 최초 요청이 삭제된 경우 원래 Prisma 오류 유지 확인
    it("P2025 이후 최초 요청이 삭제되면 기존 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const expireCareRequestIfPastFn: typeof expireCareRequestIfPast = async () => {
        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });

        throw createP2025Error();
      };

      await assert.rejects(getActiveCareRequest(ownerId, expireCareRequestIfPastFn), assertP2025);

      const deletedRequest = await prisma.careRequest.findUnique({
        where: { id: careRequestId },
      });

      assert.equal(deletedRequest, null);
    });

    // 재조회한 활성 요청에서도 P2025가 발생하면 추가 복구하지 않는지 확인
    it("새 활성 요청의 만료 처리에서도 P2025가 발생하면 기존 오류를 전달한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      let expirationCount = 0;
      let newRequestId: bigint | null = null;

      const expireCareRequestIfPastFn: typeof expireCareRequestIfPast = async () => {
        expirationCount++;

        if (expirationCount === 1) {
          const newRequest = await replaceOpenRequest(ownerId, careRequestId, futureDate(-2));

          newRequestId = newRequest.id;
        }

        throw createP2025Error();
      };

      await assert.rejects(getActiveCareRequest(ownerId, expireCareRequestIfPastFn), assertP2025);

      assert.equal(expirationCount, 2);
      assert.ok(newRequestId !== null);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: newRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
    });
  });
});
