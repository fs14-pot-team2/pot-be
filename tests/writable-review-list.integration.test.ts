import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getWritableReviews } from "../src/services/review-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

const PREFIX = `wr-${randomUUID().slice(0, 8)}`;

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

// endDate 기준으로 MATCHED 요청과 확정 견적을 만든다.
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

function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("작성 가능한 리뷰 목록 조회", () => {
  it("응답 구조가 명세와 같다", async () => {
    const ownerId = await createUser("shape-owner", "OWNER");
    const sitterId = await createUser("shape-sitter", "SITTER");
    const { careRequestId, quoteId } = await createMatchedRequest(ownerId, sitterId, -1);

    const result = await getWritableReviews(ownerId, 1, 8);

    assert.deepEqual(Object.keys(result).sort(), [
      "items",
      "page",
      "pageSize",
      "totalCount",
      "totalPages",
    ]);
    const [item] = result.items;
    assert.ok(item);
    assert.deepEqual(item.careRequest, {
      id: careRequestId.toString(),
      serviceType: "SHORT_CARE",
      endDate: dateOffset(-1).toISOString().slice(0, 10),
    });
    assert.deepEqual(item.confirmedQuote, {
      id: quoteId.toString(),
      type: "GENERAL",
      price: 50000,
    });
    assert.equal(item.sitter.id, sitterId.toString());
    assert.equal(item.sitter.nickname, `${PREFIX}-shape-sitter`);
    assert.equal(item.sitter.profileImageUrl, null);
  });

  it("작성 가능한 요청만 포함한다", async () => {
    const ownerId = await createUser("cond-owner", "OWNER");
    const otherId = await createUser("cond-other", "OWNER");
    const sitterId = await createUser("cond-sitter", "SITTER");

    const writable = await createMatchedRequest(ownerId, sitterId, -1);
    await createMatchedRequest(ownerId, sitterId, 0);
    await createMatchedRequest(otherId, sitterId, -1);
    const reviewed = await createMatchedRequest(ownerId, sitterId, -2);
    await prisma.review.create({
      data: {
        careRequestId: reviewed.careRequestId,
        ownerId,
        sitterId,
        rating: 5,
        content: "작성 완료",
      },
    });
    await prisma.careRequest.create({
      data: {
        ownerId,
        serviceType: "SHORT_CARE",
        startDate: dateOffset(-6),
        endDate: dateOffset(-4),
        zonecode: "04524",
        address: "서울특별시 중구 세종대로 110",
        sido: "서울특별시",
        sigungu: "중구",
        region: "SEOUL",
        status: "EXPIRED",
      },
    });

    const result = await getWritableReviews(ownerId, 1, 8);

    assert.deepEqual(
      result.items.map((item) => item.careRequest.id),
      [writable.careRequestId.toString()],
    );
    assert.equal(result.totalCount, 1);
  });

  it("종료일 최신순이고 같은 날이면 id 내림차순이다", async () => {
    const ownerId = await createUser("sort-owner", "OWNER");
    const sitterId = await createUser("sort-sitter", "SITTER");

    const oldest = await createMatchedRequest(ownerId, sitterId, -5);
    const sameDayFirst = await createMatchedRequest(ownerId, sitterId, -2);
    const sameDaySecond = await createMatchedRequest(ownerId, sitterId, -2);

    const result = await getWritableReviews(ownerId, 1, 8);

    assert.deepEqual(
      result.items.map((item) => item.careRequest.id),
      [
        sameDaySecond.careRequestId.toString(),
        sameDayFirst.careRequestId.toString(),
        oldest.careRequestId.toString(),
      ],
    );
  });

  it("pageSize 단위로 나누고 범위 밖 page는 빈 목록을 반환한다", async () => {
    const ownerId = await createUser("page-owner", "OWNER");
    const sitterId = await createUser("page-sitter", "SITTER");
    await createMatchedRequest(ownerId, sitterId, -1);
    await createMatchedRequest(ownerId, sitterId, -2);
    await createMatchedRequest(ownerId, sitterId, -3);

    const first = await getWritableReviews(ownerId, 1, 2);
    const second = await getWritableReviews(ownerId, 2, 2);
    const beyond = await getWritableReviews(ownerId, 5, 2);

    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 1);
    assert.equal(first.totalCount, 3);
    assert.equal(first.totalPages, 2);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.totalCount, 3);
  });

  it("작성 가능한 요청이 없으면 빈 목록을 반환한다", async () => {
    const ownerId = await createUser("empty-owner", "OWNER");

    const result = await getWritableReviews(ownerId, 1, 8);

    assert.deepEqual(result.items, []);
    assert.equal(result.totalCount, 0);
    assert.equal(result.totalPages, 0);
  });

  it("skip이 안전 정수를 넘으면 INVALID_PAGE_PARAMETER를 반환한다", async () => {
    const ownerId = await createUser("unsafe-owner", "OWNER");

    await assert.rejects(
      () => getWritableReviews(ownerId, Number.MAX_SAFE_INTEGER, 100),
      assertAppError("INVALID_PAGE_PARAMETER", 400),
    );
  });
});
