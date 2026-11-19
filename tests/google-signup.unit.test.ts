import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { signSocialSignupToken, verifySocialSignupToken } from "../src/utils/jwt.js";
import { validateGoogleSignup } from "../src/validators/social-auth-validator.js";

// env는 접근 시점에 읽으므로, 테스트에 필요한 시크릿을 미리 세팅한다.
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_SOCIAL_SIGNUP_SECRET ??= "test-social-signup-secret";

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

const payload = {
  provider: "GOOGLE" as const,
  providerUserId: "google-12345",
  email: "user@example.com",
  role: "OWNER" as const,
};

describe("구글 가입 완료 요청 검증", () => {
  it("올바른 비밀번호는 그대로 반환한다", () => {
    assert.deepEqual(validateGoogleSignup({ password: "Password123!" }), {
      password: "Password123!",
    });
  });

  it("body가 객체가 아니면 INVALID_REQUEST다", () => {
    assert.throws(() => validateGoogleSignup(null), isAppError("INVALID_REQUEST"));
    assert.throws(() => validateGoogleSignup([]), isAppError("INVALID_REQUEST"));
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
      assert.throws(
        () => validateGoogleSignup({ password }),
        isAppError("INVALID_PASSWORD_FORMAT"),
      );
    }
  });
});

describe("구글 가입 토큰", () => {
  it("GOOGLE provider 토큰은 payload를 그대로 반환한다", () => {
    const token = signSocialSignupToken(payload);

    assert.deepEqual(verifySocialSignupToken(token), payload);
  });
});
