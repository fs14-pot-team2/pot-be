import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { CareRequestStatus } from "../src/generated/prisma/enums.js";
import { getCareRequestQuotesHistoryByOwner } from "../src/services/care-request-service.js";
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
  return new Date(date.toISOString().slice(0, 10));
}

// 테스트에 사용할 돌봄 요청 생성
function createTestCareRequest(ownerId: bigint, status: CareRequestStatus, createdAt = new Date()) {
  return prisma.careRequest.create({
    data: {
      ownerId,
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
      status,
      createdAt,
    },
  });
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest(status: CareRequestStatus = "MATCHED", createdAt = new Date()) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `care-request-quotes-history-owner-${uniqueId}@example.com`,
      nickname: `care-request-quotes-history-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `care-request-quotes-history-sitter-${uniqueId}@example.com`,
      nickname: `care-request-quotes-history-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
    },
  });

  const careRequest = await createTestCareRequest(owner.id, status, createdAt);

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: careRequest.id,
  };
}

describe("받았던 견적 이력 목록 조회", () => {
  describe("조회 조건", () => {
    // 동일 생성 시각의 돌봄 요청을 ID 내림차순으로 조회하고 상태 필터별 커서 이동 시 중복·누락이 없는지 확인
    it("동일 생성 시각의 돌봄 요청을 상태 필터별로 중복·누락 없이 조회한다", async () => {
      const createdAt = new Date("2026-11-01T00:00:00.000Z");
      const { ownerId, careRequestId } = await createTestRequest("MATCHED", createdAt);

      const careRequestIds = [careRequestId];

      for (const status of ["EXPIRED", "MATCHED", "EXPIRED", "MATCHED", "EXPIRED"] as const) {
        const careRequest = await createTestCareRequest(ownerId, status, createdAt);
        careRequestIds.push(careRequest.id);
      }

      const savedCareRequests = await prisma.careRequest.findMany({
        where: {
          id: { in: careRequestIds },
        },
        select: {
          id: true,
          status: true,
        },
      });

      for (const status of [null, "MATCHED", "EXPIRED"] as const) {
        const expectedIds = savedCareRequests
          .filter((careRequest) => status === null || careRequest.status === status)
          .map((careRequest) => careRequest.id)
          .sort((firstId, secondId) => {
            if (firstId > secondId) {
              return -1;
            }

            if (firstId < secondId) {
              return 1;
            }

            return 0;
          });

        const receivedIds: bigint[] = [];
        let cursor: bigint | null = null;
        let pageCount = 0;

        while (true) {
          const careRequestQuoteHistory = await getCareRequestQuotesHistoryByOwner(ownerId, {
            cursor,
            limit: 2,
            status,
          });

          pageCount += 1;

          assert.ok(pageCount <= expectedIds.length);

          const pageIds = careRequestQuoteHistory.items.map((item) => item.careRequest.id);

          assert.ok(pageIds.length > 0);
          assert.ok(pageIds.length <= 2);

          for (const item of careRequestQuoteHistory.items) {
            if (status === null) {
              assert.ok(
                item.careRequest.status === "MATCHED" || item.careRequest.status === "EXPIRED",
              );
            } else {
              assert.equal(item.careRequest.status, status);
            }

            assert.equal(item.careRequest.createdAt.getTime(), createdAt.getTime());
          }

          receivedIds.push(...pageIds);

          if (!careRequestQuoteHistory.hasNext) {
            assert.equal(careRequestQuoteHistory.nextCursor, null);
            break;
          }

          assert.equal(careRequestQuoteHistory.nextCursor, pageIds[pageIds.length - 1]);

          cursor = careRequestQuoteHistory.nextCursor;
          assert.notEqual(cursor, null);
        }

        assert.deepEqual(receivedIds, expectedIds);
        assert.equal(new Set(receivedIds).size, expectedIds.length);
        assert.equal(pageCount, Math.ceil(expectedIds.length / 2));
      }
    });
  });

  describe("팟트너 프로필 정합성", () => {
    // 견적 작성자의 팟트너 프로필이 없으면 데이터 정합성 오류를 반환하는지 확인
    it("견적 작성자의 팟트너 프로필이 없으면 정합성 오류를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest("MATCHED");

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
        getCareRequestQuotesHistoryByOwner(ownerId, {
          cursor: null,
          limit: 4,
          status: "MATCHED",
        }),
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
      assert.equal(savedCareRequest.status, "MATCHED");
    });

    // 반려한 팟트너의 프로필이 없으면 데이터 정합성 오류를 반환하는지 확인
    it("반려한 팟트너의 프로필이 없으면 정합성 오류를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest("EXPIRED");

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
        getCareRequestQuotesHistoryByOwner(ownerId, {
          cursor: null,
          limit: 4,
          status: "EXPIRED",
        }),
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
      assert.equal(savedCareRequest.status, "EXPIRED");
    });
  });
});
