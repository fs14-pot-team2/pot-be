import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { getSitterAggregates } from "../src/services/sitter-aggregate-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";
import { serializeDate } from "../src/utils/serialize-date.js";

function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return serializeDate(date);
}

async function createUser(role: "OWNER" | "SITTER", prefix: string) {
  const uniqueId = randomUUID();
  return prisma.user.create({
    data: {
      email: `${prefix}-${uniqueId}@example.com`,
      nickname: `${prefix}-${uniqueId}`,
      passwordHash: "test-only",
      role,
    },
  });
}

// 돌봄 요청 1건 + 팟트너의 견적 1건 생성 (confirm이 true면 확정 처리)
async function createQuotedRequest(ownerId: bigint, sitterId: bigint, confirm: boolean) {
  const request = await prisma.careRequest.create({
    data: {
      ownerId,
      serviceType: "SHORT_CARE",
      startDate: new Date(`${futureDate(7)}T00:00:00.000Z`),
      endDate: new Date(`${futureDate(14)}T00:00:00.000Z`),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      sido: "서울특별시",
      sigungu: "중구",
      region: "SEOUL",
      status: "OPEN",
    },
  });
  const quote = await prisma.quote.create({
    data: {
      careRequestId: request.id,
      sitterId,
      type: "GENERAL",
      price: 50000,
      comment: "테스트 견적입니다.",
    },
  });
  if (confirm) {
    await prisma.careRequest.update({
      where: { id: request.id },
      data: { confirmedQuoteId: quote.id, status: "MATCHED" },
    });
  }
  return request;
}

describe("팟트너 집계", () => {
  // 리뷰 2건(5점, 4점) + 확정 견적 2건 + 미확정 견적 1건 → 평균 4.5, 리뷰 2, 확정 2
  it("리뷰와 확정 견적을 팟트너별로 집계한다", async () => {
    const owner = await createUser("OWNER", "agg-owner");
    const sitter = await createUser("SITTER", "agg-sitter");

    const confirmed = await createQuotedRequest(owner.id, sitter.id, true);
    const second = await createQuotedRequest(owner.id, sitter.id, true);
    await createQuotedRequest(owner.id, sitter.id, false);

    await prisma.review.create({
      data: {
        careRequestId: confirmed.id,
        ownerId: owner.id,
        sitterId: sitter.id,
        rating: 5,
        content: "좋았어요",
      },
    });
    await prisma.review.create({
      data: {
        careRequestId: second.id,
        ownerId: owner.id,
        sitterId: sitter.id,
        rating: 4,
        content: "괜찮았어요",
      },
    });

    const aggregates = await getSitterAggregates([sitter.id]);

    assert.deepEqual(aggregates.get(sitter.id), {
      averageRating: 4.5,
      reviewCount: 2,
      confirmedQuoteCount: 2,
    });
  });

  // 리뷰도 견적도 없는 팟트너 → 전부 0
  it("리뷰와 견적이 없으면 0을 반환한다", async () => {
    const sitter = await createUser("SITTER", "agg-empty");

    const aggregates = await getSitterAggregates([sitter.id]);

    assert.deepEqual(aggregates.get(sitter.id), {
      averageRating: 0,
      reviewCount: 0,
      confirmedQuoteCount: 0,
    });
  });

  // 여러 팟트너를 한 번에 조회해도 서로 섞이지 않는다
  it("여러 팟트너를 한 번에 조회해도 팟트너별로 분리한다", async () => {
    const owner = await createUser("OWNER", "agg-multi-owner");
    const withReview = await createUser("SITTER", "agg-multi-a");
    const withoutReview = await createUser("SITTER", "agg-multi-b");

    const request = await createQuotedRequest(owner.id, withReview.id, true);
    await prisma.review.create({
      data: {
        careRequestId: request.id,
        ownerId: owner.id,
        sitterId: withReview.id,
        rating: 3,
        content: "보통이에요",
      },
    });

    const aggregates = await getSitterAggregates([withReview.id, withoutReview.id]);

    assert.equal(aggregates.get(withReview.id)?.reviewCount, 1);
    assert.equal(aggregates.get(withReview.id)?.confirmedQuoteCount, 1);
    assert.equal(aggregates.get(withoutReview.id)?.reviewCount, 0);
    assert.equal(aggregates.get(withoutReview.id)?.confirmedQuoteCount, 0);
  });

  it("삭제된 리뷰는 평균 별점과 리뷰 수에서 제외한다", async () => {
    const owner = await createUser("OWNER", "agg-softdel-owner");
    const sitter = await createUser("SITTER", "agg-softdel-sitter");
    const first = await createQuotedRequest(owner.id, sitter.id, true);
    const second = await createQuotedRequest(owner.id, sitter.id, true);

    await prisma.review.create({
      data: {
        careRequestId: first.id,
        ownerId: owner.id,
        sitterId: sitter.id,
        rating: 5,
        content: "유지되는 리뷰",
      },
    });
    await prisma.review.create({
      data: {
        careRequestId: second.id,
        ownerId: owner.id,
        sitterId: sitter.id,
        rating: 1,
        content: "삭제된 리뷰",
        deletedAt: new Date(),
      },
    });

    const aggregates = await getSitterAggregates([sitter.id]);

    assert.deepEqual(aggregates.get(sitter.id), {
      averageRating: 5,
      reviewCount: 1,
      confirmedQuoteCount: 2,
    });
  });
});
