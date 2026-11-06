import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { MAX_IMAGE_SIZE, validatePresignedUrlRequest } from "../src/validators/image-validator.js";

function assertAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

describe("프로필 이미지 presigned URL 요청 검증", () => {
  for (const contentType of ["image/jpeg", "image/png", "image/webp"]) {
    it(`${contentType}은 허용한다`, () => {
      assert.doesNotThrow(() => validatePresignedUrlRequest({ contentType, fileSize: 1 }));
    });
  }

  for (const contentType of ["image/gif", "image/svg+xml", "application/pdf", "", 123, null]) {
    it(`${String(contentType)}은 INVALID_PROFILE_IMAGE로 거부한다`, () => {
      assert.throws(
        () => validatePresignedUrlRequest({ contentType, fileSize: 1000 }),
        assertAppError("INVALID_PROFILE_IMAGE"),
      );
    });
  }

  const sizeCases: Array<[string, unknown, boolean]> = [
    ["0", 0, false],
    ["1", 1, true],
    ["5MB", MAX_IMAGE_SIZE, true],
    ["5MB + 1", MAX_IMAGE_SIZE + 1, false],
    ["음수", -1, false],
    ["소수", 1.5, false],
    ["문자열", "100", false],
  ];
  for (const [title, fileSize, ok] of sizeCases) {
    it(`fileSize ${title}는 ${ok ? "허용" : "거부"}한다`, () => {
      const run = () => validatePresignedUrlRequest({ contentType: "image/png", fileSize });
      if (ok) assert.doesNotThrow(run);
      else assert.throws(run, assertAppError("INVALID_PROFILE_IMAGE"));
    });
  }

  it("body가 객체가 아니면 INVALID_REQUEST", () => {
    for (const body of [null, [], "x", undefined]) {
      assert.throws(() => validatePresignedUrlRequest(body), assertAppError("INVALID_REQUEST"));
    }
  });
});
