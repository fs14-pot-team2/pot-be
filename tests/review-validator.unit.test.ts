import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import {
  validateCreateReviewBody,
  validateReviewIdParam,
  validateUpdateReviewBody,
} from "../src/validators/review-validator.js";

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

describe("리뷰 생성 본문 검증", () => {
  it("저장할 content는 앞뒤 공백을 포함한 원문을 유지한다", () => {
    const result = validateCreateReviewBody({ rating: 5, content: "  친절해요  " });

    assert.equal(result.content, "  친절해요  ");
  });

  it("공백만 있는 content는 INVALID_REVIEW_CONTENT다", () => {
    assert.throws(
      () => validateCreateReviewBody({ rating: 5, content: "   " }),
      isAppError("INVALID_REVIEW_CONTENT"),
    );
  });
});

describe("리뷰 수정 요청 검증", () => {
  it("body가 없거나 비어 있으면 빈 입력을 반환한다", () => {
    assert.deepEqual(validateUpdateReviewBody(undefined), {});
    assert.deepEqual(validateUpdateReviewBody({}), {});
  });

  it("전달된 필드만 반환한다", () => {
    assert.deepEqual(validateUpdateReviewBody({ rating: 4 }), { rating: 4 });
    assert.deepEqual(validateUpdateReviewBody({ content: "내용" }), { content: "내용" });
  });

  it("body가 객체가 아니면 INVALID_REQUEST를 반환한다", () => {
    assert.throws(() => validateUpdateReviewBody([]), isAppError("INVALID_REQUEST"));
    assert.throws(() => validateUpdateReviewBody("text"), isAppError("INVALID_REQUEST"));
  });

  it("별점이 1~5 정수가 아니면 INVALID_REVIEW_RATING을 반환한다", () => {
    for (const rating of [0, 6, 3.5, "5", null]) {
      assert.throws(
        () => validateUpdateReviewBody({ rating }),
        isAppError("INVALID_REVIEW_RATING"),
        `rating=${String(rating)}`,
      );
    }
  });

  it("내용이 공백뿐이거나 150자를 넘거나 문자열이 아니면 INVALID_REVIEW_CONTENT를 반환한다", () => {
    for (const content of ["   ", "", "가".repeat(151), 123]) {
      assert.throws(
        () => validateUpdateReviewBody({ content }),
        isAppError("INVALID_REVIEW_CONTENT"),
      );
    }
  });

  it("글자 수는 공백을 제외하고 세며 저장 값은 원문이다", () => {
    const content = "가 ".repeat(150);

    assert.deepEqual(validateUpdateReviewBody({ content }), { content });
  });

  it("ID가 숫자가 아니면 INVALID_ID를 반환한다", () => {
    assert.equal(validateReviewIdParam("12"), 12n);
    assert.throws(() => validateReviewIdParam("abc"), isAppError("INVALID_ID"));
  });
});
