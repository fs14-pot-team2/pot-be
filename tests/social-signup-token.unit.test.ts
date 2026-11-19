import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import jwt from "jsonwebtoken";

import { signSocialSignupToken, verifySocialSignupToken } from "../src/utils/jwt.js";

const SECRET = "test-social-signup-secret";

describe("소셜 가입 임시 토큰 provider", () => {
  beforeEach(() => {
    process.env.JWT_SOCIAL_SIGNUP_SECRET = SECRET;
  });

  it("GOOGLE 토큰도 발급하고 검증한다", () => {
    const payload = {
      provider: "GOOGLE" as const,
      providerUserId: "109876543210",
      email: "user@example.com",
      role: "OWNER" as const,
    };

    assert.deepEqual(verifySocialSignupToken(signSocialSignupToken(payload)), payload);
  });

  it("지원하지 않는 provider 토큰은 null이다", () => {
    const token = jwt.sign(
      {
        provider: "NAVER",
        providerUserId: "1",
        email: "user@example.com",
        role: "OWNER",
        purpose: "social-signup",
      },
      SECRET,
      { algorithm: "HS256", expiresIn: 60 },
    );

    assert.equal(verifySocialSignupToken(token), null);
  });
});
