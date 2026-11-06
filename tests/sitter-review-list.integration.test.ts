import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getSitterReviews } from "../src/services/review-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 이번 테스트 실행에서 만든 데이터만 구분하기 위함
const PREFIX = `srl-${randomUUID().slice(0, 8)}`;

async function createSitter(name: string, withProfile = true) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${name}@example.com`,
      nickname: `${PREFIX}-${name}`,
      passwordHash: "test-only",
      role: "SITTER",
      ...(withProfile && {
        sitterProfile: {
          create: {
            gender: "FEMALE",
            shortIntroduction: "테스트용 팟트너",
            sitterServices: { create: [{ serviceType: "SHORT_CARE" }] },
            sitterServiceRegions: { create: [{ region: "SEOUL" }] },
          },
        },
      }),
    },
  });
  return user.id;
}

async function createOwner(name: string) {
  const owner = await prisma.user.create({
    data: {
      email: `${PREFIX}-${name}@example.com`,
      nickname: `${PREFIX}-${name}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });
  return { id: owner.id, nickname: owner.nickname };
}

interface ReviewSeed {
  rating: number;
  createdAt?: Date;
}

// Review는 careRequest당 1개라 리뷰마다 MATCHED 요청을 함께 만든다.
// 반환 순서는 생성 순서(= id 오름차순)와 같다.
async function addReviews(sitterId: bigint, ownerId: bigint, seeds: ReviewSeed[]) {
  const reviewIds: bigint[] = [];

  for (const { rating, createdAt } of seeds) {
    const careRequest = await prisma.careRequest.create({
      data: {
        ownerId,
        serviceType: "SHORT_CARE",
        startDate: futureDate(7),
        endDate: futureDate(14),
        zonecode: "04524",
        address: "서울특별시 중구 세종대로 110",
        sido: "서울특별시",
        sigungu: "중구",
        region: "SEOUL",
        status: "MATCHED",
      },
    });

    const review = await prisma.review.create({
      data: {
        careRequestId: careRequest.id,
        ownerId,
        sitterId,
        rating,
        content: `테스트 리뷰 ${rating}점`,
        ...(createdAt && { createdAt }),
      },
    });
    reviewIds.push(review.id);
  }

  return reviewIds;
}

function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("팟트너 리뷰 목록 조회", () => {
  describe("응답 구조", () => {
    it("명세에 맞는 summary와 items 필드를 반환한다", async () => {
      const sitterId = await createSitter("shape-sitter");
      const owner = await createOwner("shape-owner");
      const [reviewId] = await addReviews(sitterId, owner.id, [{ rating: 5 }]);

      const result = await getSitterReviews(sitterId, 1, 8);

      assert.deepEqual(Object.keys(result).sort(), [
        "items",
        "page",
        "pageSize",
        "summary",
        "totalCount",
        "totalPages",
      ]);
      assert.deepEqual(Object.keys(result.summary).sort(), [
        "averageRating",
        "ratingDistribution",
        "reviewCount",
      ]);

      const [item] = result.items;
      assert.ok(item);
      assert.deepEqual(Object.keys(item.review).sort(), ["content", "createdAt", "id", "rating"]);
      assert.equal(item.review.id, reviewId!.toString());
      assert.equal(item.review.rating, 5);
      assert.equal(item.review.content, "테스트 리뷰 5점");
      assert.equal(typeof item.review.createdAt, "string");
      assert.equal(new Date(item.review.createdAt).toISOString(), item.review.createdAt);
      assert.deepEqual(item.owner, { id: owner.id.toString(), nickname: owner.nickname });
    });
  });

  describe("집계", () => {
    it("리뷰가 없으면 빈 목록과 0으로 채운 분포를 반환한다", async () => {
      const sitterId = await createSitter("empty-sitter");

      const result = await getSitterReviews(sitterId, 1, 8);

      assert.deepEqual(result.items, []);
      assert.equal(result.totalCount, 0);
      assert.equal(result.totalPages, 0);
      assert.equal(result.summary.averageRating, 0);
      assert.equal(result.summary.reviewCount, 0);
      assert.deepEqual(result.summary.ratingDistribution, {
        "5": 0,
        "4": 0,
        "3": 0,
        "2": 0,
        "1": 0,
      });
    });

    it("평균 평점, 리뷰 수, 별점 분포를 계산한다", async () => {
      const sitterId = await createSitter("agg-sitter");
      const owner = await createOwner("agg-owner");
      await addReviews(sitterId, owner.id, [{ rating: 5 }, { rating: 5 }, { rating: 4 }]); // 4.666... → 4.7

      const result = await getSitterReviews(sitterId, 1, 8);

      assert.equal(result.summary.averageRating, 4.7);
      assert.equal(result.summary.reviewCount, 3);
      assert.deepEqual(result.summary.ratingDistribution, {
        "5": 2,
        "4": 1,
        "3": 0,
        "2": 0,
        "1": 0,
      });
      assert.equal(result.totalCount, 3);
    });

    it("다른 팟트너가 받은 리뷰는 포함하지 않는다", async () => {
      const sitterId = await createSitter("scope-sitter");
      const otherSitterId = await createSitter("scope-other");
      const owner = await createOwner("scope-owner");
      const [mine] = await addReviews(sitterId, owner.id, [{ rating: 5 }]);
      await addReviews(otherSitterId, owner.id, [{ rating: 1 }, { rating: 1 }]);

      const result = await getSitterReviews(sitterId, 1, 8);

      assert.deepEqual(
        result.items.map((item) => item.review.id),
        [mine!.toString()],
      );
      assert.equal(result.summary.reviewCount, 1);
      assert.deepEqual(result.summary.ratingDistribution, {
        "5": 1,
        "4": 0,
        "3": 0,
        "2": 0,
        "1": 0,
      });
    });
  });

  describe("정렬", () => {
    it("작성일 최신순이고 같은 시각이면 id 내림차순이다", async () => {
      const sitterId = await createSitter("sort-sitter");
      const owner = await createOwner("sort-owner");
      const now = new Date();
      const older = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const [oldest, sameTimeFirst, sameTimeSecond] = await addReviews(sitterId, owner.id, [
        { rating: 3, createdAt: older },
        { rating: 4, createdAt: now },
        { rating: 5, createdAt: now },
      ]);

      const result = await getSitterReviews(sitterId, 1, 8);

      assert.deepEqual(
        result.items.map((item) => item.review.id),
        [sameTimeSecond!.toString(), sameTimeFirst!.toString(), oldest!.toString()],
      );
    });
  });

  describe("페이지네이션", () => {
    it("pageSize 단위로 나누고 totalCount와 totalPages를 계산한다", async () => {
      const sitterId = await createSitter("page-sitter");
      const owner = await createOwner("page-owner");
      await addReviews(sitterId, owner.id, [{ rating: 5 }, { rating: 4 }, { rating: 3 }]);

      const first = await getSitterReviews(sitterId, 1, 2);
      const second = await getSitterReviews(sitterId, 2, 2);

      assert.equal(first.items.length, 2);
      assert.equal(second.items.length, 1);
      assert.equal(first.page, 1);
      assert.equal(first.pageSize, 2);
      assert.equal(first.totalCount, 3);
      assert.equal(first.totalPages, 2);

      const allIds = [...first.items, ...second.items].map((item) => item.review.id);
      assert.equal(new Set(allIds).size, 3);
    });

    it("totalPages를 넘어선 page는 빈 목록을 반환한다", async () => {
      const sitterId = await createSitter("beyond-sitter");
      const owner = await createOwner("beyond-owner");
      await addReviews(sitterId, owner.id, [{ rating: 5 }]);

      const result = await getSitterReviews(sitterId, 5, 8);

      assert.deepEqual(result.items, []);
      assert.equal(result.totalCount, 1);
      assert.equal(result.totalPages, 1);
    });

    it("skip이 안전 정수를 넘으면 INVALID_PAGE_PARAMETER를 반환한다", async () => {
      const sitterId = await createSitter("unsafe-sitter");

      await assert.rejects(
        () => getSitterReviews(sitterId, Number.MAX_SAFE_INTEGER, 100),
        assertAppError("INVALID_PAGE_PARAMETER", 400),
      );
    });
  });

  describe("조회 대상", () => {
    it("존재하지 않는 팟트너는 SITTER_NOT_FOUND를 반환한다", async () => {
      await assert.rejects(
        () => getSitterReviews(999999999999n, 1, 8),
        assertAppError("SITTER_NOT_FOUND", 404),
      );
    });

    it("팟트너 프로필이 없는 사용자는 SITTER_NOT_FOUND를 반환한다", async () => {
      const userId = await createSitter("noprofile-sitter", false);

      await assert.rejects(
        () => getSitterReviews(userId, 1, 8),
        assertAppError("SITTER_NOT_FOUND", 404),
      );
    });
  });
});
