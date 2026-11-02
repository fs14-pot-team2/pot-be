import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { createDesignatedRequest } from "../src/services/designated-request-service.js";
import { ignoreCareRequest } from "../src/services/ignored-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";
import { serializeDate } from "../src/utils/serialize-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return serializeDate(date);
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

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest() {
  const uniqueId = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `ignore-owner-${uniqueId}@example.com`,
      nickname: `ignore-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `ignore-sitter-${uniqueId}@example.com`,
      nickname: `ignore-sitter-${uniqueId}`,
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
      startDate: new Date(`${futureDate(7)}T00:00:00.000Z`),
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

  return { ownerId: owner.id, sitterId: sitter.id, careRequestId: request.id };
}

describe("공개 돌봄 요청 숨김", () => {
  describe("UNIQUE 제약 충돌 처리", () => {
    // P2002 숨김 요청 복합 UNIQUE 제약 충돌 시 중복 숨김 도메인 오류 변환 확인
    it("P2002 발생 시 숨김 요청 중복 오류를 반환한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const runTransaction = async () => {
        throw createP2002Error("IgnoredRequest_careRequestId_sitterId_key");
      };

      await assert.rejects(
        ignoreCareRequest(sitterId, careRequestId, runTransaction),
        assertAppError("REQUEST_ALREADY_IGNORED"),
      );

      assert.equal(await prisma.ignoredRequest.count({ where: { careRequestId, sitterId } }), 0);
    });

    // P2002 다른 UNIQUE 제약 충돌 시 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 다른 UNIQUE 제약이면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const runTransaction = async () => {
        throw createP2002Error("User_email_role_key");
      };

      await assert.rejects(ignoreCareRequest(sitterId, careRequestId, runTransaction), assertP2002);

      assert.equal(await prisma.ignoredRequest.count({ where: { careRequestId, sitterId } }), 0);
    });

    // P2002 UNIQUE 제약 이름을 식별할 수 없으면 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 UNIQUE 제약 이름이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const runTransaction = async () => {
        throw createP2002Error();
      };

      await assert.rejects(ignoreCareRequest(sitterId, careRequestId, runTransaction), assertP2002);

      assert.equal(await prisma.ignoredRequest.count({ where: { careRequestId, sitterId } }), 0);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 동일 팟트너의 동시 숨김 요청에서 하나만 생성되고 다른 요청은 중복 오류로 거부되는지 확인
    it("동일 팟트너 동시 숨김 시 중복 생성을 방지한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();

      const results = await Promise.allSettled([
        ignoreCareRequest(sitterId, careRequestId),
        ignoreCareRequest(sitterId, careRequestId),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("REQUEST_ALREADY_IGNORED")(rejected[0].reason));

      assert.equal(await prisma.ignoredRequest.count({ where: { careRequestId, sitterId } }), 1);
    });

    // 숨김과 지정 요청이 동시에 실행되어도 지정 요청은 한 건 생성되고 숨김 결과가 순서에 맞게 결정되는지 확인
    it("숨김과 지정 요청이 동시에 실행되면 지정 요청을 생성하고 숨김 여부를 처리 순서에 따라 결정한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const [ignoredResult, designatedResult] = await Promise.allSettled([
        ignoreCareRequest(sitterId, careRequestId),
        createDesignatedRequest(ownerId, careRequestId, sitterId),
      ]);

      assert.equal(designatedResult.status, "fulfilled");

      assert.equal(await prisma.designatedRequest.count({ where: { careRequestId, sitterId } }), 1);

      const ignoredCount = await prisma.ignoredRequest.count({
        where: { careRequestId, sitterId },
      });

      if (ignoredResult.status === "fulfilled") {
        assert.equal(ignoredCount, 1);
        assert.equal(ignoredResult.value.careRequestId, careRequestId);
        assert.equal(ignoredResult.value.sitterId, sitterId);
      } else {
        assert.ok(assertAppError("REQUEST_IGNORE_NOT_ALLOWED")(ignoredResult.reason));
        assert.equal(ignoredCount, 0);
      }
    });
  });

  // TODO: 팟트너 프로필 지역 수정에 동일한 SitterProfile 행 잠금이 적용되면
  // 지역 변경과 숨김 처리의 동시 실행 및 잠금 이후 지역 재조회 검증 추가
});
