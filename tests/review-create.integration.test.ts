import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { createReview } from "../src/services/review-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";
import { getUniqueConstraintName } from "../src/utils/prisma-error.js";

const PREFIX = `rc-${randomUUID().slice(0, 8)}`;

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
  return careRequest.id;
}

function assertAppError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

const input = { rating: 5, content: "정말 친절하셨어요." };

describe("리뷰 생성", () => {
  it("종료일 다음 날 이후에는 리뷰를 작성하고 확정된 팟트너가 대상이 된다", async () => {
    const ownerId = await createUser("ok-owner", "OWNER");
    const sitterId = await createUser("ok-sitter", "SITTER");
    const careRequestId = await createMatchedRequest(ownerId, sitterId, -1);

    const result = await createReview(ownerId, careRequestId, input);

    assert.equal(result.careRequestId, careRequestId.toString());
    assert.equal(result.ownerId, ownerId.toString());
    assert.equal(result.sitterId, sitterId.toString());
    assert.equal(result.rating, 5);
    assert.equal(new Date(result.createdAt).toISOString(), result.createdAt);
  });

  it("종료일 당일에는 REVIEW_NOT_WRITABLE을 반환한다", async () => {
    const ownerId = await createUser("today-owner", "OWNER");
    const sitterId = await createUser("today-sitter", "SITTER");
    const careRequestId = await createMatchedRequest(ownerId, sitterId, 0);

    await assert.rejects(
      () => createReview(ownerId, careRequestId, input),
      assertAppError("REVIEW_NOT_WRITABLE", 409),
    );
  });

  it("MATCHED가 아니면 REVIEW_NOT_WRITABLE을 반환한다", async () => {
    const ownerId = await createUser("open-owner", "OWNER");
    const careRequest = await prisma.careRequest.create({
      data: {
        ownerId,
        serviceType: "SHORT_CARE",
        startDate: dateOffset(-5),
        endDate: dateOffset(-3),
        zonecode: "04524",
        address: "서울특별시 중구 세종대로 110",
        sido: "서울특별시",
        sigungu: "중구",
        region: "SEOUL",
        status: "EXPIRED",
      },
    });

    await assert.rejects(
      () => createReview(ownerId, careRequest.id, input),
      assertAppError("REVIEW_NOT_WRITABLE", 409),
    );
  });

  it("다른 팟오너의 요청은 FORBIDDEN을 반환한다", async () => {
    const ownerId = await createUser("own-owner", "OWNER");
    const otherId = await createUser("own-other", "OWNER");
    const sitterId = await createUser("own-sitter", "SITTER");
    const careRequestId = await createMatchedRequest(ownerId, sitterId, -1);

    await assert.rejects(
      () => createReview(otherId, careRequestId, input),
      assertAppError("FORBIDDEN", 403),
    );
  });

  it("존재하지 않는 요청은 CARE_REQUEST_NOT_FOUND를 반환한다", async () => {
    const ownerId = await createUser("nf-owner", "OWNER");

    await assert.rejects(
      () => createReview(ownerId, 999999999999n, input),
      assertAppError("CARE_REQUEST_NOT_FOUND", 404),
    );
  });

  it("이미 리뷰가 있으면 REVIEW_ALREADY_EXISTS를 반환한다", async () => {
    const ownerId = await createUser("dup-owner", "OWNER");
    const sitterId = await createUser("dup-sitter", "SITTER");
    const careRequestId = await createMatchedRequest(ownerId, sitterId, -1);
    await createReview(ownerId, careRequestId, input);

    await assert.rejects(
      () => createReview(ownerId, careRequestId, input),
      assertAppError("REVIEW_ALREADY_EXISTS", 409),
    );
  });

  it("동시에 두 번 요청해도 하나만 성공하고 나머지는 REVIEW_ALREADY_EXISTS다", async () => {
    const ownerId = await createUser("race-owner", "OWNER");
    const sitterId = await createUser("race-sitter", "SITTER");
    const careRequestId = await createMatchedRequest(ownerId, sitterId, -1);

    const results = await Promise.allSettled([
      createReview(ownerId, careRequestId, input),
      createReview(ownerId, careRequestId, input),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(assertAppError("REVIEW_ALREADY_EXISTS", 409)(rejected.reason));
  });

  it("UNIQUE 충돌 에러에서 제약 이름을 추출한다", async () => {
    const ownerId = await createUser("uq-owner", "OWNER");
    const sitterId = await createUser("uq-sitter", "SITTER");
    const careRequestId = await createMatchedRequest(ownerId, sitterId, -1);

    const data = { careRequestId, ownerId, sitterId, rating: 5, content: "a" };
    await prisma.review.create({ data });

    await assert.rejects(
      () => prisma.review.create({ data }),
      (error) => getUniqueConstraintName(error) === "Review_careRequestId_key",
    );
  });
});
