import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getRejectedRequestsBySitter } from "../src/services/designated-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

type CareRequestStatus = "OPEN" | "MATCHED" | "CANCELED" | "EXPIRED";

// KST 기준 테스트용 날짜 생성
function dateFromToday(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

// 테스트용 팟트너 생성
async function createTestSitter(createProfile = true) {
  const uniqueId = randomUUID();

  const sitter = await prisma.user.create({
    data: {
      email: `rejected-history-sitter-${uniqueId}@example.com`,
      nickname: `rejected-history-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
      ...(createProfile && {
        sitterProfile: {
          create: {
            gender: "FEMALE",
            shortIntroduction: "테스트용 팟트너",
          },
        },
      }),
    },
  });

  return sitter.id;
}

// 테스트용 돌봄 요청 및 지정 요청 생성
async function createTestDesignatedRequest(sitterId: bigint) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `rejected-history-owner-${uniqueId}@example.com`,
      nickname: `rejected-history-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: dateFromToday(7),
      endDate: dateFromToday(14),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: "태평로1가",
      region: "SEOUL",
      status: "OPEN",
    },
  });

  const designatedRequest = await prisma.designatedRequest.create({
    data: {
      careRequestId: careRequest.id,
      sitterId,
    },
  });

  return {
    ownerId: owner.id,
    careRequestId: careRequest.id,
    designatedRequestId: designatedRequest.id,
  };
}

// 지정 요청 반려 데이터 생성 및 돌봄 요청 상태 변경
async function createTestRejection(sitterId: bigint, status: CareRequestStatus, createdAt: Date) {
  const request = await createTestDesignatedRequest(sitterId);

  const rejectedRequest = await prisma.rejectedRequest.create({
    data: {
      designatedRequestId: request.designatedRequestId,
      reason: "테스트용 지정 요청 반려 사유입니다.",
      createdAt,
    },
  });

  if (status === "MATCHED") {
    const otherSitterId = await createTestSitter();

    const quote = await prisma.quote.create({
      data: {
        careRequestId: request.careRequestId,
        sitterId: otherSitterId,
        type: "GENERAL",
        price: 10000,
        comment: "테스트용 돌봄 견적입니다.",
      },
    });

    await prisma.careRequest.update({
      where: { id: request.careRequestId },
      data: {
        status: "MATCHED",
        confirmedQuoteId: quote.id,
      },
    });
  }

  if (status === "CANCELED") {
    await prisma.careRequest.update({
      where: { id: request.careRequestId },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
      },
    });
  }

  if (status === "EXPIRED") {
    await prisma.careRequest.update({
      where: { id: request.careRequestId },
      data: {
        status: "EXPIRED",
        startDate: dateFromToday(-7),
        endDate: dateFromToday(-1),
      },
    });
  }

  return {
    ...request,
    rejectedRequestId: rejectedRequest.id,
    createdAt: rejectedRequest.createdAt,
  };
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("반려 요청 이력 목록 조회", () => {
  describe("조회 조건", () => {
    // 본인이 반려한 요청만 조회하고 다른 팟트너의 반려는 제외하는지 확인
    it("본인이 반려한 지정 요청만 반환한다", async () => {
      const sitterId = await createTestSitter();
      const otherSitterId = await createTestSitter();

      const ownRejection = await createTestRejection(
        sitterId,
        "OPEN",
        new Date("2026-10-01T09:00:00.000Z"),
      );

      const otherRejection = await createTestRejection(
        otherSitterId,
        "OPEN",
        new Date("2026-10-02T09:00:00.000Z"),
      );

      const result = await getRejectedRequestsBySitter(sitterId, 1, 8);

      assert.equal(result.totalCount, 1);
      assert.equal(result.totalPages, 1);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, ownRejection.rejectedRequestId);
      assert.equal(
        result.items.some((item) => item.id === otherRejection.rejectedRequestId),
        false,
      );
    });

    // 돌봄 요청 상태와 관계없이 기존 반려를 조회하는지 확인
    it("돌봄 요청 상태와 관계없이 반려를 조회한다", async () => {
      const sitterId = await createTestSitter();
      const statuses = ["OPEN", "MATCHED", "CANCELED", "EXPIRED"] as const;

      const rejections = await Promise.all(
        statuses.map((status, index) =>
          createTestRejection(sitterId, status, new Date(Date.UTC(2026, 9, index + 1))),
        ),
      );

      const result = await getRejectedRequestsBySitter(sitterId, 1, 8);

      assert.equal(result.totalCount, 4);
      assert.deepEqual(
        new Set(result.items.map((item) => item.id)),
        new Set(rejections.map((item) => item.rejectedRequestId)),
      );

      const savedStatuses = await prisma.careRequest.findMany({
        where: {
          id: { in: rejections.map((item) => item.careRequestId) },
        },
        select: { status: true },
      });

      assert.deepEqual(new Set(savedStatuses.map((request) => request.status)), new Set(statuses));
    });

    // 반려한 요청이 없는 경우 빈 목록 및 페이지 정보 확인
    it("반려한 요청이 없으면 빈 목록을 반환한다", async () => {
      const sitterId = await createTestSitter();

      const result = await getRejectedRequestsBySitter(sitterId, 1, 8);

      assert.deepEqual(result, {
        items: [],
        page: 1,
        pageSize: 8,
        totalCount: 0,
        totalPages: 0,
      });
    });

    // 프로필 미등록 팟트너의 조회를 차단하는지 확인
    it("팟트너 프로필이 없으면 FORBIDDEN을 반환한다", async () => {
      const sitterId = await createTestSitter(false);

      await assert.rejects(
        getRejectedRequestsBySitter(sitterId, 1, 8),
        assertAppError("FORBIDDEN", 403),
      );
    });
  });

  describe("정렬 및 페이지네이션", () => {
    // 반려일 최신순, 동일 시각 ID 내림차순 및 페이지별 조회 결과 확인
    it("반려일 및 ID 내림차순으로 정렬하고 페이지를 분할한다", async () => {
      const sitterId = await createTestSitter();

      const first = await createTestRejection(
        sitterId,
        "OPEN",
        new Date("2026-10-01T00:00:00.000Z"),
      );

      const second = await createTestRejection(
        sitterId,
        "OPEN",
        new Date("2026-10-02T00:00:00.000Z"),
      );

      const third = await createTestRejection(
        sitterId,
        "OPEN",
        new Date("2026-10-02T00:00:00.000Z"),
      );

      const fourth = await createTestRejection(
        sitterId,
        "OPEN",
        new Date("2026-10-03T00:00:00.000Z"),
      );

      const expectedIds = [
        fourth.rejectedRequestId,
        third.rejectedRequestId,
        second.rejectedRequestId,
        first.rejectedRequestId,
      ];

      const firstPage = await getRejectedRequestsBySitter(sitterId, 1, 2);
      const secondPage = await getRejectedRequestsBySitter(sitterId, 2, 2);
      const emptyPage = await getRejectedRequestsBySitter(sitterId, 3, 2);

      assert.deepEqual(
        firstPage.items.map((item) => item.id),
        expectedIds.slice(0, 2),
      );
      assert.deepEqual(
        secondPage.items.map((item) => item.id),
        expectedIds.slice(2),
      );

      assert.equal(firstPage.totalCount, 4);
      assert.equal(firstPage.totalPages, 2);
      assert.equal(secondPage.totalCount, 4);
      assert.equal(secondPage.totalPages, 2);
      assert.deepEqual(emptyPage.items, []);
    });
  });

  describe("조회 중 데이터 변경", () => {
    // 반려 생성과 목록 조회가 동시에 실행되어도 허용된 결과를 반환하는지 확인
    it("반려 생성과 목록 조회가 동시에 실행되어도 허용된 결과를 반환한다", async () => {
      const sitterId = await createTestSitter();
      const request = await createTestDesignatedRequest(sitterId);

      // count()와 findMany()는 별도 쿼리로 실행하므로 조회 시점 차이를 허용한다.
      // 따라서 totalCount와 items.length가 일시적으로 달라도 오류로 판단하지 않는다.
      // 특정 두 쿼리 사이의 반려 생성을 강제하지 않고, 동시 실행 시 결과 범위를 검증한다.
      const [result, createdRejection] = await Promise.all([
        getRejectedRequestsBySitter(sitterId, 1, 8),
        prisma.rejectedRequest.create({
          data: {
            designatedRequestId: request.designatedRequestId,
            reason: "목록 조회 중 생성하는 반려 사유입니다.",
          },
        }),
      ]);

      assert.ok(result.totalCount === 0 || result.totalCount === 1);
      assert.ok(result.items.length <= 1);
      assert.equal(result.page, 1);
      assert.equal(result.pageSize, 8);
      assert.equal(result.totalPages, Math.ceil(result.totalCount / 8));

      for (const item of result.items) {
        assert.equal(item.id, createdRejection.id);
        assert.equal(item.designatedRequest.id, request.designatedRequestId);
      }

      const savedCount = await prisma.rejectedRequest.count({
        where: {
          designatedRequest: { sitterId },
        },
      });

      assert.equal(savedCount, 1);
    });
  });
});
