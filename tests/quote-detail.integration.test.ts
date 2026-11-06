import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getQuoteDetail } from "../src/services/quote-service.js";

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 견적 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `quote-detail-owner-${uniqueId}@example.com`,
      nickname: `quote-detail-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `quote-detail-sitter-${uniqueId}@example.com`,
      nickname: `quote-detail-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
    },
  });

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-07T00:00:00.000Z"),
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

  const quote = await prisma.quote.create({
    data: {
      careRequestId: request.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 10000,
      comment: "테스트용 견적 내용입니다.",
    },
  });

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    quoteId: quote.id,
  };
}

describe("견적 상세 조회", () => {
  describe("조회 조건", () => {
    // 기존 견적 작성자의 필수 팟트너 프로필이 없으면 데이터 정합성 오류를 반환하는지 확인
    it("견적 작성자의 팟트너 프로필이 없으면 정합성 오류를 반환한다", async () => {
      const { ownerId, sitterId, quoteId } = await createTestRequest();

      const sitterProfile = await prisma.sitterProfile.findUnique({
        where: { userId: sitterId },
      });

      assert.equal(sitterProfile, null);

      await assert.rejects(
        getQuoteDetail(quoteId, { id: ownerId, role: "OWNER" }),
        assertAppError("SITTER_PROFILE_INCONSISTENT", 500),
      );

      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: { id: quoteId },
      });

      assert.equal(savedQuote.sitterId, sitterId);
    });
  });
});
