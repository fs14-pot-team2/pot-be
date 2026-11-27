import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import AppError from "../src/errors/app-error.js";
import { updateSitterProfile } from "../src/services/profile-service.js";
import { getQuoteDetail } from "../src/services/quote-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 테스트에 사용할 독립적인 팟오너 생성
function createTestOwner() {
  const uniqueId = randomUUID();

  return prisma.user.create({
    data: {
      email: `quote-detail-owner-${uniqueId}@example.com`,
      nickname: `quote-detail-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });
}

// 테스트에 사용할 독립적인 팟트너 생성
function createTestSitter(hasProfile = true) {
  const uniqueId = randomUUID();

  const sitterData: Prisma.UserCreateInput = {
    email: `quote-detail-sitter-${uniqueId}@example.com`,
    nickname: `quote-detail-sitter-${uniqueId}`,
    passwordHash: "test-only",
    role: "SITTER",
  };

  if (hasProfile) {
    sitterData.sitterProfile = {
      create: {
        gender: "FEMALE",
        shortIntroduction: "테스트용 팟트너",
        sitterServiceRegions: {
          create: [{ region: "SEOUL" }],
        },
      },
    };
  }

  return prisma.user.create({
    data: sitterData,
  });
}

// 테스트에 사용할 견적 생성
function createTestQuote(careRequestId: bigint, sitterId: bigint) {
  return prisma.quote.create({
    data: {
      careRequestId,
      sitterId,
      type: "GENERAL",
      price: 10000,
      comment: "테스트용 견적 내용입니다.",
    },
  });
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청, 팟트너 및 견적 생성
async function createTestRequest(hasSitterProfile = true) {
  const owner = await createTestOwner();
  const sitter = await createTestSitter(hasSitterProfile);

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

  const quote = await createTestQuote(request.id, sitter.id);

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: request.id,
    quoteId: quote.id,
    request,
  };
}

type QuoteDetail = Awaited<ReturnType<typeof getQuoteDetail>>;

// 전체 주소 공개 여부 확인
function assertFullAddress(
  quoteDetail: QuoteDetail,
  request: Awaited<ReturnType<typeof createTestRequest>>["request"],
) {
  assert.equal(quoteDetail.careRequest.sido, request.sido);
  assert.equal(quoteDetail.careRequest.sigungu, request.sigungu);
  assert.equal(quoteDetail.careRequest.bname, request.bname);
  assert.equal(quoteDetail.careRequest.zonecode, request.zonecode);
  assert.equal(quoteDetail.careRequest.address, request.address);
  assert.equal(quoteDetail.careRequest.detailAddress, request.detailAddress);
}

// 일부 주소 공개 및 상세 주소 비공개 여부 확인
function assertPartialAddress(
  quoteDetail: QuoteDetail,
  request: Awaited<ReturnType<typeof createTestRequest>>["request"],
) {
  assert.equal(quoteDetail.careRequest.sido, request.sido);
  assert.equal(quoteDetail.careRequest.sigungu, request.sigungu);
  assert.equal(quoteDetail.careRequest.bname, request.bname);
  assert.equal(quoteDetail.careRequest.zonecode, null);
  assert.equal(quoteDetail.careRequest.address, null);
  assert.equal(quoteDetail.careRequest.detailAddress, null);
}

describe("견적 상세 조회", () => {
  describe("조회 조건", () => {
    // 기존 견적 작성자의 필수 팟트너 프로필이 없으면 데이터 정합성 오류를 반환하는지 확인
    it("견적 작성자의 팟트너 프로필이 없으면 정합성 오류를 반환한다", async () => {
      const { ownerId, sitterId, quoteId } = await createTestRequest(false);

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

    // 서비스 지역이 일치하거나 지정 요청을 받았더라도 타인의 견적 조회를 차단하는지 확인
    it("서비스 지역 일치 및 지정 요청 수신 여부와 관계없이 타인의 견적 조회를 차단한다", async () => {
      const { careRequestId, quoteId } = await createTestRequest();

      const sameRegionSitter = await createTestSitter();
      const designatedSitter = await createTestSitter();

      await updateSitterProfile(designatedSitter.id, {
        serviceRegions: ["INCHEON"],
      });

      await prisma.designatedRequest.create({
        data: {
          careRequestId,
          sitterId: designatedSitter.id,
        },
      });

      await assert.rejects(
        getQuoteDetail(quoteId, { id: sameRegionSitter.id, role: "SITTER" }),
        assertAppError("QUOTE_ACCESS_FORBIDDEN", 403),
      );

      await assert.rejects(
        getQuoteDetail(quoteId, { id: designatedSitter.id, role: "SITTER" }),
        assertAppError("QUOTE_ACCESS_FORBIDDEN", 403),
      );
    });

    // 동일한 돌봄 요청에 견적을 제출했더라도 다른 작성자의 견적 조회를 차단하는지 확인
    it("동일한 돌봄 요청에 견적을 제출한 다른 팟트너의 견적 조회를 차단한다", async () => {
      const { careRequestId, quoteId } = await createTestRequest();

      const otherSitter = await createTestSitter();
      await createTestQuote(careRequestId, otherSitter.id);

      await assert.rejects(
        getQuoteDetail(quoteId, { id: otherSitter.id, role: "SITTER" }),
        assertAppError("QUOTE_ACCESS_FORBIDDEN", 403),
      );
    });

    // 견적 제출 이후 서비스 가능 지역이 변경되어도 본인의 견적 조회가 가능한지 확인
    it("견적 제출 이후 서비스 가능 지역을 변경해도 본인의 견적을 조회한다", async () => {
      const { sitterId, quoteId } = await createTestRequest();

      await updateSitterProfile(sitterId, {
        serviceRegions: ["INCHEON"],
      });

      const quoteDetail = await getQuoteDetail(quoteId, {
        id: sitterId,
        role: "SITTER",
      });

      assert.equal(quoteDetail.quote.id, quoteId);
      assert.equal(quoteDetail.sitter.id, sitterId);
    });

    // 돌봄 요청을 생성하지 않은 다른 팟오너의 견적 조회를 차단하는지 확인
    it("돌봄 요청 생성자 외 다른 팟오너의 견적 조회를 차단한다", async () => {
      const { quoteId } = await createTestRequest();
      const otherOwner = await createTestOwner();

      await assert.rejects(
        getQuoteDetail(quoteId, { id: otherOwner.id, role: "OWNER" }),
        assertAppError("QUOTE_ACCESS_FORBIDDEN", 403),
      );
    });

    // 취소된 돌봄 요청의 견적은 요청자와 견적 작성자 모두 조회할 수 없는지 확인
    it("CANCELED 상태에서는 요청자와 견적 작성자의 견적 조회를 차단한다", async () => {
      const { ownerId, sitterId, careRequestId, quoteId } = await createTestRequest();

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
        },
      });

      await assert.rejects(
        getQuoteDetail(quoteId, { id: ownerId, role: "OWNER" }),
        assertAppError("QUOTE_ACCESS_FORBIDDEN", 403),
      );

      await assert.rejects(
        getQuoteDetail(quoteId, { id: sitterId, role: "SITTER" }),
        assertAppError("QUOTE_ACCESS_FORBIDDEN", 403),
      );
    });
  });

  describe("주소 공개 범위", () => {
    // OPEN 상태에서 요청자는 전체 주소, 견적 작성자는 일부 주소를 조회하는지 확인
    it("OPEN 상태에서는 요청자에게 전체 주소, 견적 작성자에게 일부 주소를 반환한다", async () => {
      const { ownerId, sitterId, quoteId, request } = await createTestRequest();

      const ownerQuoteDetail = await getQuoteDetail(quoteId, {
        id: ownerId,
        role: "OWNER",
      });

      const sitterQuoteDetail = await getQuoteDetail(quoteId, {
        id: sitterId,
        role: "SITTER",
      });

      assertFullAddress(ownerQuoteDetail, request);
      assertPartialAddress(sitterQuoteDetail, request);
    });

    // MATCHED 상태에서 요청자와 확정 견적 작성자는 전체 주소, 미확정 견적 작성자는 일부 주소를 조회하는지 확인
    it("MATCHED 상태에서는 요청자 및 확정 견적 작성자에게만 전체 주소를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId, quoteId, request } = await createTestRequest();

      const otherSitter = await createTestSitter();
      const otherQuote = await createTestQuote(careRequestId, otherSitter.id);

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: {
          status: "MATCHED",
          confirmedQuoteId: quoteId,
        },
      });

      const ownerQuoteDetail = await getQuoteDetail(quoteId, {
        id: ownerId,
        role: "OWNER",
      });

      const confirmedSitterQuoteDetail = await getQuoteDetail(quoteId, {
        id: sitterId,
        role: "SITTER",
      });

      const unconfirmedSitterQuoteDetail = await getQuoteDetail(otherQuote.id, {
        id: otherSitter.id,
        role: "SITTER",
      });

      assertFullAddress(ownerQuoteDetail, request);
      assertFullAddress(confirmedSitterQuoteDetail, request);
      assertPartialAddress(unconfirmedSitterQuoteDetail, request);
    });

    // EXPIRED 상태에서 요청자는 전체 주소, 견적 작성자는 일부 주소를 조회하는지 확인
    it("EXPIRED 상태에서는 요청자에게 전체 주소, 견적 작성자에게 일부 주소를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId, quoteId, request } = await createTestRequest();

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: {
          status: "EXPIRED",
          startDate: futureDate(-7),
          endDate: futureDate(-1),
        },
      });

      const ownerQuoteDetail = await getQuoteDetail(quoteId, {
        id: ownerId,
        role: "OWNER",
      });

      const sitterQuoteDetail = await getQuoteDetail(quoteId, {
        id: sitterId,
        role: "SITTER",
      });

      assertFullAddress(ownerQuoteDetail, request);
      assertPartialAddress(sitterQuoteDetail, request);
    });
  });
});
