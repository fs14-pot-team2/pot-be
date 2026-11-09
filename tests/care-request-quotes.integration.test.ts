import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getOpenCareRequestQuotes } from "../src/services/care-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `care-request-quotes-owner-${uniqueId}@example.com`,
      nickname: `care-request-quotes-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `care-request-quotes-sitter-${uniqueId}@example.com`,
      nickname: `care-request-quotes-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
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

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: request.id,
  };
}

describe("요청한 견적 현황 조회", () => {
  describe("팟트너 프로필 정합성", () => {
    // 견적 작성자의 팟트너 프로필이 없으면 데이터 정합성 오류를 반환하는지 확인
    it("견적 작성자의 팟트너 프로필이 없으면 정합성 오류를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const quote = await prisma.quote.create({
        data: {
          careRequestId,
          sitterId,
          type: "GENERAL",
          price: 10000,
          comment: "테스트용 견적 내용입니다.",
        },
      });

      const sitterProfile = await prisma.sitterProfile.findUnique({
        where: { userId: sitterId },
      });

      assert.equal(sitterProfile, null);

      await assert.rejects(
        getOpenCareRequestQuotes(ownerId),
        assertAppError("SITTER_PROFILE_INCONSISTENT", 500),
      );

      const [savedQuote, savedCareRequest] = await Promise.all([
        prisma.quote.findUniqueOrThrow({
          where: { id: quote.id },
        }),
        prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        }),
      ]);

      assert.equal(savedQuote.sitterId, sitterId);
      assert.equal(savedCareRequest.status, "OPEN");
    });

    // 반려한 팟트너의 프로필이 없으면 데이터 정합성 오류를 반환하는지 확인
    it("반려한 팟트너의 프로필이 없으면 정합성 오류를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const designatedRequest = await prisma.designatedRequest.create({
        data: {
          careRequestId,
          sitterId,
        },
      });

      const rejectedRequest = await prisma.rejectedRequest.create({
        data: {
          designatedRequestId: designatedRequest.id,
          reason: "테스트를 위한 지정 요청 반려 사유입니다.",
        },
      });

      const sitterProfile = await prisma.sitterProfile.findUnique({
        where: { userId: sitterId },
      });

      assert.equal(sitterProfile, null);

      await assert.rejects(
        getOpenCareRequestQuotes(ownerId),
        assertAppError("SITTER_PROFILE_INCONSISTENT", 500),
      );

      const [savedDesignatedRequest, savedRejectedRequest, savedCareRequest] = await Promise.all([
        prisma.designatedRequest.findUniqueOrThrow({
          where: { id: designatedRequest.id },
        }),
        prisma.rejectedRequest.findUniqueOrThrow({
          where: { id: rejectedRequest.id },
        }),
        prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        }),
      ]);

      assert.equal(savedDesignatedRequest.sitterId, sitterId);
      assert.equal(savedRejectedRequest.designatedRequestId, designatedRequest.id);
      assert.equal(savedCareRequest.status, "OPEN");
    });
  });
});
