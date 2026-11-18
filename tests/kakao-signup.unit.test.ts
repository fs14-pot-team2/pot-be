import assert from "node:assert/strict";
import { describe, it } from "node:test";

import jwt from "jsonwebtoken";

import { env } from "../src/config/env.js";
import AppError from "../src/errors/app-error.js";
import { signSocialSignupToken, verifySocialSignupToken } from "../src/utils/jwt.js";
import { validateKakaoSignup } from "../src/validators/social-auth-validator.js";

// env는 접근 시점에 읽으므로, 테스트에 필요한 시크릿을 미리 세팅한다.
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_SOCIAL_SIGNUP_SECRET ??= "test-social-signup-secret";

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

const payload = {
  provider: "KAKAO" as const,
  providerUserId: "12345",
  email: "user@example.com",
  role: "OWNER" as const,
};

describe("카카오 가입 완료 요청 검증", () => {
  it("올바른 비밀번호는 그대로 반환한다", () => {
    assert.deepEqual(validateKakaoSignup({ password: "Password123!" }), {
      password: "Password123!",
    });
  });

  it("body가 객체가 아니면 INVALID_REQUEST다", () => {
    assert.throws(() => validateKakaoSignup(null), isAppError("INVALID_REQUEST"));
    assert.throws(() => validateKakaoSignup([]), isAppError("INVALID_REQUEST"));
  });

  it("비밀번호 형식이 올바르지 않으면 INVALID_PASSWORD_FORMAT이다", () => {
    for (const password of [
      undefined,
      1,
      "",
      "short1!",
      "a".repeat(21),
      "한글비밀번호123",
      "pass word1",
    ]) {
      assert.throws(() => validateKakaoSignup({ password }), isAppError("INVALID_PASSWORD_FORMAT"));
    }
  });
});

describe("가입 토큰 검증", () => {
  it("유효한 토큰은 payload를 반환한다", () => {
    const token = signSocialSignupToken(payload);

    assert.deepEqual(verifySocialSignupToken(token), payload);
  });

  it("위조된 토큰은 null이다", () => {
    const forged = jwt.sign({ ...payload, purpose: "social-signup" }, "wrong-secret", {
      algorithm: "HS256",
    });

    assert.equal(verifySocialSignupToken(forged), null);
    assert.equal(verifySocialSignupToken("not-a-jwt"), null);
  });

  it("만료된 토큰은 null이다", () => {
    const expired = jwt.sign({ ...payload, purpose: "social-signup" }, env.jwtSocialSignupSecret, {
      algorithm: "HS256",
      expiresIn: -1,
    });

    assert.equal(verifySocialSignupToken(expired), null);
  });

  it("purpose가 다른 토큰은 null이다", () => {
    const wrongPurpose = jwt.sign(
      { ...payload, purpose: "profile-update" },
      env.jwtSocialSignupSecret,
      {
        algorithm: "HS256",
      },
    );

    assert.equal(verifySocialSignupToken(wrongPurpose), null);
  });

  it("access token 시크릿으로 서명한 토큰은 null이다", () => {
    const accessSigned = jwt.sign({ ...payload, purpose: "social-signup" }, env.jwtAccessSecret, {
      algorithm: "HS256",
    });

    assert.equal(verifySocialSignupToken(accessSigned), null);
  });
});
