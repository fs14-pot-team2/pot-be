import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { env } from "../src/config/env.js";
import AppError from "../src/errors/app-error.js";
import { validateProfileImageUrl } from "../src/validators/profile-validator.js";

const base = env.profileImageCloudfrontUrl.replace(/\/+$/, "");
const UUID = "3f2a9c1e-7b4d-4e8a-9d21-5c6b8a0e1f34";
const sitter = { id: 2n, role: "SITTER" as const };

function assertInvalid(value: unknown) {
  assert.throws(
    () => validateProfileImageUrl(value, sitter),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_PROFILE_IMAGE",
  );
}

describe("프로필 이미지 URL 검증", () => {
  it("본인 role/ID 경로의 URL은 허용한다", () => {
    const url = `${base}/profile-images/sitter/2/${UUID}.png`;
    assert.equal(validateProfileImageUrl(url, sitter), url);
  });

  it("null은 허용한다", () => {
    assert.equal(validateProfileImageUrl(null, sitter), null);
  });

  it("다른 userId 경로는 거부한다", () =>
    assertInvalid(`${base}/profile-images/sitter/3/${UUID}.png`));
  it("다른 role 경로는 거부한다", () =>
    assertInvalid(`${base}/profile-images/owner/2/${UUID}.png`));
  it("외부 도메인은 거부한다", () =>
    assertInvalid(`https://example.com/profile-images/sitter/2/${UUID}.png`));
  it("쿼리스트링은 거부한다", () =>
    assertInvalid(`${base}/profile-images/sitter/2/${UUID}.png?x=1`));
  it("경로 우회(..)는 거부한다", () =>
    assertInvalid(`${base}/profile-images/sitter/2/../3/${UUID}.png`));
  it("허용하지 않는 확장자는 거부한다", () =>
    assertInvalid(`${base}/profile-images/sitter/2/${UUID}.gif`));
  it("문자열이 아니면 거부한다", () => assertInvalid(123));
});
