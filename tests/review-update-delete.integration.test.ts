import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import {
  deleteReview,
  getSitterReviews,
  getWritableReviews,
  updateReview,
} from "../src/services/review-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

const PREFIX = `ru-${randomUUID().slice(0, 8)}`;
const MISSING_REVIEW_ID = 9_223_372_036_854_775_807n;

function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

async function createUser(name: string, role: "OWNER" | "SITTER") {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${name}@example.com`,
      nickname: `${PREFIX}-${name}`,
      passwordHash: "test-only",
      role,
      ...(role === "OWNER"
        ? { ownerProfile: { create: {} } }
        : {
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

async function createMatchedRequest(ownerId: bigint, sitterId: bigint, endOffsetDays: number) {
  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId,
      serviceType: "SHORT_CARE",
      startDate: dateOffset(endOffsetDays - 3),
      endDate: dateOffset(endOffsetDays),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      sido: "서울특별시",
      sigungu: "중구",
      region: "SEOUL",
      status: "MATCHED",
    },
  });
  const quote = await prisma.quote.create({
    data: {
      careRequestId: careRequest.id,
      sitterId,
      type: "GENERAL",
      price: 50000,
      comment: "테스트 견적 코멘트입니다.",
    },
  });
  await prisma.careRequest.update({
    where: { id: careRequest.id },
    data: { confirmedQuoteId: quote.id },
  });
  return { careRequestId: careRequest.id, quoteId: quote.id };
}

async function createReview(
  careRequestId: bigint,
  ownerId: bigint,
  sitterId: bigint,
  options: { rating?: number; content?: string } = {},
) {
  return prisma.review.create({
    data: {
      careRequestId,
      ownerId,
      sitterId,
      rating: options.rating ?? 5,
      content: options.content ?? "테스트 리뷰입니다.",
    },
  });
}

// 팟오너·팟트너·확정 요청·리뷰를 한 번에 만든다.
async function setupReview(name: string, options: { rating?: number; content?: string } = {}) {
  const ownerId = await createUser(`${name}-owner`, "OWNER");
  const sitterId = await createUser(`${name}-sitter`, "SITTER");
  const { careRequestId } = await createMatchedRequest(ownerId, sitterId, -1);
  const review = await createReview(careRequestId, ownerId, sitterId, options);
  return { ownerId, sitterId, careRequestId, review };
}

function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("내가 작성한 리뷰 수정", () => {
  it("응답 구조가 명세와 같다", async () => {
    const { ownerId, sitterId, careRequestId, review } = await setupReview("up-shape");

    const result = await updateReview(ownerId, review.id, {
      rating: 4,
      content: "수정된 리뷰입니다.",
    });

    assert.deepEqual(Object.keys(result).sort(), [
      "careRequestId",
      "content",
      "id",
      "ownerId",
      "rating",
      "sitterId",
      "updatedAt",
    ]);
    assert.equal(result.id, review.id.toString());
    assert.equal(result.careRequestId, careRequestId.toString());
    assert.equal(result.ownerId, ownerId.toString());
    assert.equal(result.sitterId, sitterId.toString());
    assert.equal(result.rating, 4);
    assert.equal(result.content, "수정된 리뷰입니다.");
    assert.equal(new Date(result.updatedAt).toISOString(), result.updatedAt);
  });

  it("별점만 전달하면 내용은 유지된다", async () => {
    const { ownerId, review } = await setupReview("up-rating", { content: "원래 내용입니다." });

    const result = await updateReview(ownerId, review.id, { rating: 2 });

    assert.equal(result.rating, 2);
    assert.equal(result.content, "원래 내용입니다.");
  });

  it("내용만 전달하면 별점은 유지되고 원문이 그대로 저장된다", async () => {
    const { ownerId, review } = await setupReview("up-content", { rating: 3 });

    const result = await updateReview(ownerId, review.id, { content: "  앞뒤 공백 포함  " });

    assert.equal(result.rating, 3);
    assert.equal(result.content, "  앞뒤 공백 포함  ");
  });

  it("전달된 필드가 없어도 요청을 허용하고 값은 유지된다", async () => {
    const { ownerId, review } = await setupReview("up-empty", {
      rating: 4,
      content: "그대로 유지되는 내용입니다.",
    });

    const result = await updateReview(ownerId, review.id, {});

    assert.equal(result.rating, 4);
    assert.equal(result.content, "그대로 유지되는 내용입니다.");
    // 빈 수정에서 updatedAt이 갱신되는지는 명세에 없어서 역행하지 않는지만 확인한다.
    assert.ok(new Date(result.updatedAt).getTime() >= review.updatedAt.getTime());
  });

  it("다른 팟오너가 수정하면 REVIEW_ACCESS_FORBIDDEN을 반환하고 값은 바뀌지 않는다", async () => {
    const { review } = await setupReview("up-forbidden", { rating: 5 });
    const strangerId = await createUser("up-forbidden-stranger", "OWNER");

    await assert.rejects(
      () => updateReview(strangerId, review.id, { rating: 1 }),
      assertAppError("REVIEW_ACCESS_FORBIDDEN", 403),
    );

    const saved = await prisma.review.findUnique({ where: { id: review.id } });
    assert.equal(saved?.rating, 5);
  });

  it("리뷰를 받은 팟트너도 수정할 수 없다", async () => {
    const { sitterId, review } = await setupReview("up-sitter");

    await assert.rejects(
      () => updateReview(sitterId, review.id, { rating: 1 }),
      assertAppError("REVIEW_ACCESS_FORBIDDEN", 403),
    );
  });

  it("없는 리뷰는 REVIEW_NOT_FOUND를 반환한다", async () => {
    const ownerId = await createUser("up-missing-owner", "OWNER");

    await assert.rejects(
      () => updateReview(ownerId, MISSING_REVIEW_ID, { rating: 1 }),
      assertAppError("REVIEW_NOT_FOUND", 404),
    );
  });
  it("삭제된 리뷰는 수정할 수 없다", async () => {
    const { ownerId, review } = await setupReview("up-deleted", { rating: 5 });
    await deleteReview(ownerId, review.id);

    await assert.rejects(
      () => updateReview(ownerId, review.id, { rating: 1 }),
      assertAppError("REVIEW_NOT_FOUND", 404),
    );

    const saved = await prisma.review.findUnique({ where: { id: review.id } });
    assert.equal(saved?.rating, 5);
  });
});

describe("내가 작성한 리뷰 삭제", () => {
  it("메시지를 반환하고 리뷰를 소프트 삭제하며 돌봄 요청은 유지한다", async () => {
    const { ownerId, careRequestId, review } = await setupReview("del-ok");

    const result = await deleteReview(ownerId, review.id);

    assert.deepEqual(result, { message: "리뷰가 삭제되었습니다." });
    const deleted = await prisma.review.findUnique({ where: { id: review.id } });
    assert.ok(deleted?.deletedAt instanceof Date); // 행은 남고 deletedAt만 기록된다
    assert.ok(await prisma.careRequest.findUnique({ where: { id: careRequestId } }));
  });

  it("삭제하면 팟트너의 리뷰 개수와 평균 별점에 반영된다", async () => {
    const ownerId = await createUser("del-agg-owner", "OWNER");
    const sitterId = await createUser("del-agg-sitter", "SITTER");
    const first = await createMatchedRequest(ownerId, sitterId, -1);
    const second = await createMatchedRequest(ownerId, sitterId, -2);
    await createReview(first.careRequestId, ownerId, sitterId, { rating: 5 });
    const target = await createReview(second.careRequestId, ownerId, sitterId, { rating: 3 });

    const before = await getSitterReviews(sitterId, 1, 8);
    await deleteReview(ownerId, target.id);
    const after = await getSitterReviews(sitterId, 1, 8);

    assert.equal(before.summary.reviewCount, 2);
    assert.equal(before.summary.averageRating, 4);
    assert.equal(after.summary.reviewCount, 1);
    assert.equal(after.summary.averageRating, 5);
    assert.equal(after.summary.ratingDistribution["3"], 0);
  });

  it("다른 팟오너가 삭제하면 REVIEW_ACCESS_FORBIDDEN을 반환하고 리뷰는 남는다", async () => {
    const { review } = await setupReview("del-forbidden");
    const strangerId = await createUser("del-forbidden-stranger", "OWNER");

    await assert.rejects(
      () => deleteReview(strangerId, review.id),
      assertAppError("REVIEW_ACCESS_FORBIDDEN", 403),
    );

    assert.ok(await prisma.review.findUnique({ where: { id: review.id } }));
  });

  it("없는 리뷰와 이미 삭제된 리뷰는 REVIEW_NOT_FOUND를 반환한다", async () => {
    const { ownerId, review } = await setupReview("del-missing");

    await assert.rejects(
      () => deleteReview(ownerId, MISSING_REVIEW_ID),
      assertAppError("REVIEW_NOT_FOUND", 404),
    );

    await deleteReview(ownerId, review.id);
    await assert.rejects(
      () => deleteReview(ownerId, review.id),
      assertAppError("REVIEW_NOT_FOUND", 404),
    );
  });

  it("같은 리뷰를 동시에 삭제하면 한 건만 성공하고 나머지는 REVIEW_NOT_FOUND다", async () => {
    const { ownerId, review } = await setupReview("del-race");

    const results = await Promise.allSettled([
      deleteReview(ownerId, review.id),
      deleteReview(ownerId, review.id),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(assertAppError("REVIEW_NOT_FOUND", 404)(rejected[0].reason));
    const saved = await prisma.review.findUnique({ where: { id: review.id } });
    assert.ok(saved?.deletedAt instanceof Date);
  });
  it("삭제해도 이력이 남아 작성 가능 목록에 다시 나타나지 않는다", async () => {
    const { ownerId, review } = await setupReview("del-history");

    await deleteReview(ownerId, review.id);

    const writable = await getWritableReviews(ownerId, 1, 8);
    assert.equal(writable.totalCount, 0);
  });
});
