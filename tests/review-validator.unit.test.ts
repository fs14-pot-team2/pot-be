import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validateCreateReviewBody } from "../src/validators/review-validator.js";

describe("리뷰 생성 본문 검증", () => {
  it("저장할 content는 앞뒤 공백을 포함한 원문을 유지한다", () => {
    const result = validateCreateReviewBody({ rating: 5, content: "  친절해요  " });

    assert.equal(result.content, "  친절해요  ");
  });

  it("공백만 있는 content는 INVALID_REVIEW_CONTENT다", () => {
    assert.throws(
      () => validateCreateReviewBody({ rating: 5, content: "   " }),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_REVIEW_CONTENT",
    );
  });
});
