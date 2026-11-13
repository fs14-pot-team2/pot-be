import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getMyReviews } from "../src/services/review-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

const PREFIX = `mr-${randomUUID().slice(0, 8)}`;

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

// 확정된 요청에 리뷰를 만든다. createdAt을 지정하면 정렬 검증에 쓸 수 있다.
async function createReview(
  careRequestId: bigint,
  ownerId: bigint,
  sitterId: bigint,
  options: { rating?: number; content?: string; createdAt?: Date } = {},
) {
  return prisma.review.create({
    data: {
      careRequestId,
      ownerId,
      sitterId,
      rating: options.rating ?? 5,
      content: options.content ?? "테스트 리뷰입니다.",
      ...(options.createdAt && { createdAt: options.createdAt }),
    },
  });
}

function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("내가 작성한 리뷰 목록 조회", () => {
  it("응답 구조가 명세와 같다", async () => {
    const ownerId = await createUser("shape-owner", "OWNER");
    const sitterId = await createUser("shape-sitter", "SITTER");
    const { careRequestId } = await createMatchedRequest(ownerId, sitterId, -1);
    const review = await createReview(careRequestId, ownerId, sitterId, {
      rating: 4,
      content: "꼼꼼하게 돌봐주셨어요.",
    });

    const result = await getMyReviews(ownerId, 1, 8);

    assert.deepEqual(Object.keys(result).sort(), [
      "items",
      "page",
      "pageSize",
      "totalCount",
      "totalPages",
    ]);
    const [item] = result.items;
    assert.ok(item);
    assert.deepEqual(Object.keys(item).sort(), [
      "careRequest",
      "confirmedQuote",
      "review",
      "sitter",
    ]);
    assert.deepEqual(item.review, {
      id: review.id.toString(),
      rating: 4,
      content: "꼼꼼하게 돌봐주셨어요.",
      createdAt: review.createdAt.toISOString(),
    });
    assert.deepEqual(item.careRequest, {
      id: careRequestId.toString(),
      serviceType: "SHORT_CARE",
      endDate: dateOffset(-1).toISOString().slice(0, 10),
    });
    // 명세상 confirmedQuote에는 id가 없고 type, price만 있다.
    assert.deepEqual(item.confirmedQuote, { type: "GENERAL", price: 50000 });
    assert.equal(item.sitter.id, sitterId.toString());
    assert.equal(item.sitter.nickname, `${PREFIX}-shape-sitter`);
    assert.equal(item.sitter.profileImageUrl, null);
  });

  it("본인이 작성한 리뷰만 포함한다", async () => {
    const ownerId = await createUser("own-owner", "OWNER");
    const otherId = await createUser("own-other", "OWNER");
    const sitterId = await createUser("own-sitter", "SITTER");

    const mine = await createMatchedRequest(ownerId, sitterId, -1);
    await createReview(mine.careRequestId, ownerId, sitterId);
    const others = await createMatchedRequest(otherId, sitterId, -1);
    await createReview(others.careRequestId, otherId, sitterId);
    // 리뷰를 작성하지 않은 본인 요청
    await createMatchedRequest(ownerId, sitterId, -2);

    const result = await getMyReviews(ownerId, 1, 8);

    assert.deepEqual(
      result.items.map((item) => item.careRequest.id),
      [mine.careRequestId.toString()],
    );
    assert.equal(result.totalCount, 1);
  });

  it("삭제된 리뷰는 목록과 totalCount에서 제외한다", async () => {
    const ownerId = await createUser("softdel-owner", "OWNER");
    const sitterId = await createUser("softdel-sitter", "SITTER");
    const kept = await createMatchedRequest(ownerId, sitterId, -1);
    const removed = await createMatchedRequest(ownerId, sitterId, -2);
    await createReview(kept.careRequestId, ownerId, sitterId);
    const target = await createReview(removed.careRequestId, ownerId, sitterId);
    await prisma.review.update({ where: { id: target.id }, data: { deletedAt: new Date() } });

    const result = await getMyReviews(ownerId, 1, 8);

    assert.deepEqual(
      result.items.map((item) => item.careRequest.id),
      [kept.careRequestId.toString()],
    );
    assert.equal(result.totalCount, 1);
  });

  it("작성일 최신순이고 같은 시각이면 id 내림차순이다", async () => {
    const ownerId = await createUser("sort-owner", "OWNER");
    const sitterId = await createUser("sort-sitter", "SITTER");
    const sameTime = new Date(Date.now() - 60_000);

    const oldest = await createMatchedRequest(ownerId, sitterId, -5);
    const sameFirst = await createMatchedRequest(ownerId, sitterId, -4);
    const sameSecond = await createMatchedRequest(ownerId, sitterId, -3);
    const newest = await createMatchedRequest(ownerId, sitterId, -2);

    await createReview(oldest.careRequestId, ownerId, sitterId, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await createReview(sameFirst.careRequestId, ownerId, sitterId, { createdAt: sameTime });
    await createReview(sameSecond.careRequestId, ownerId, sitterId, { createdAt: sameTime });
    await createReview(newest.careRequestId, ownerId, sitterId, { createdAt: new Date() });

    const result = await getMyReviews(ownerId, 1, 8);

    assert.deepEqual(
      result.items.map((item) => item.careRequest.id),
      [
        newest.careRequestId.toString(),
        sameSecond.careRequestId.toString(),
        sameFirst.careRequestId.toString(),
        oldest.careRequestId.toString(),
      ],
    );
  });

  it("pageSize 단위로 나누고 범위 밖 page는 빈 목록을 반환한다", async () => {
    const ownerId = await createUser("page-owner", "OWNER");
    const sitterId = await createUser("page-sitter", "SITTER");

    for (const offset of [-1, -2, -3]) {
      const { careRequestId } = await createMatchedRequest(ownerId, sitterId, offset);
      await createReview(careRequestId, ownerId, sitterId);
    }

    const first = await getMyReviews(ownerId, 1, 2);
    const second = await getMyReviews(ownerId, 2, 2);
    const beyond = await getMyReviews(ownerId, 5, 2);

    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 1);
    assert.equal(first.totalCount, 3);
    assert.equal(first.totalPages, 2);
    // 페이지 간 중복·누락이 없어야 한다.
    const ids = [...first.items, ...second.items].map((item) => item.review.id);
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.totalCount, 3);
  });

  it("작성한 리뷰가 없으면 빈 목록을 반환한다", async () => {
    const ownerId = await createUser("empty-owner", "OWNER");

    const result = await getMyReviews(ownerId, 1, 8);

    assert.deepEqual(result.items, []);
    assert.equal(result.totalCount, 0);
    assert.equal(result.totalPages, 0);
  });

  it("skip이 안전 정수를 넘으면 INVALID_PAGE_PARAMETER를 반환한다", async () => {
    const ownerId = await createUser("unsafe-owner", "OWNER");

    await assert.rejects(
      () => getMyReviews(ownerId, Number.MAX_SAFE_INTEGER, 100),
      assertAppError("INVALID_PAGE_PARAMETER", 400),
    );
  });
});
