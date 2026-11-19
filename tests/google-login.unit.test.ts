import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { fetchGoogleProfile } from "../src/utils/google-client.js";
import { validateGoogleLogin } from "../src/validators/social-auth-validator.js";

const originalFetch = globalThis.fetch;

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

type Call = { url: string; init?: RequestInit };

// 토큰 교환 요청과 프로필 조회 요청을 URL로 구분해 응답을 돌려준다.
function mockGoogleFetch(options: { tokenResponse?: Response; profileResponse?: Response }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) {
      return options.tokenResponse ?? Response.json({ access_token: "google-token" });
    }
    return options.profileResponse ?? Response.json({});
  }) as typeof fetch;
  return calls;
}

const validProfile = { sub: "109876543210", email: "User@Example.com", email_verified: true };
const REDIRECT_URI = "http://localhost:3000/auth/google/callback";

describe("구글 로그인 요청 검증", () => {
  const valid = {
    role: "OWNER",
    code: "auth-code",
    redirectUri: "http://localhost:3000/auth/google/callback",
  };

  it("올바른 요청은 그대로 반환한다", () => {
    assert.deepEqual(validateGoogleLogin(valid), valid);
  });

  it("body가 객체가 아니면 INVALID_REQUEST다", () => {
    assert.throws(() => validateGoogleLogin(null), isAppError("INVALID_REQUEST"));
    assert.throws(() => validateGoogleLogin([]), isAppError("INVALID_REQUEST"));
  });

  it("role이 올바르지 않으면 INVALID_USER_ROLE이다", () => {
    assert.throws(
      () => validateGoogleLogin({ ...valid, role: "ADMIN" }),
      isAppError("INVALID_USER_ROLE"),
    );
  });

  it("code가 비었거나 문자열이 아니면 INVALID_REQUEST다", () => {
    assert.throws(
      () => validateGoogleLogin({ ...valid, code: "  " }),
      isAppError("INVALID_REQUEST"),
    );
    assert.throws(() => validateGoogleLogin({ ...valid, code: 1 }), isAppError("INVALID_REQUEST"));
  });

  it("redirectUri가 http, https URL이 아니면 INVALID_REQUEST다", () => {
    for (const redirectUri of ["not-a-url", "javascript:alert(1)", "ftp://example.com/callback"]) {
      assert.throws(
        () => validateGoogleLogin({ ...valid, redirectUri }),
        isAppError("INVALID_REQUEST"),
      );
    }
  });

  it("redirectUri가 https 스킴이면 허용한다", () => {
    const input = { ...valid, redirectUri: "https://example.com/auth/google/callback" };

    assert.deepEqual(validateGoogleLogin(input), input);
  });
});

describe("구글 프로필 조회", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sub를 providerUserId로, 이메일을 소문자로 반환한다", async () => {
    mockGoogleFetch({ profileResponse: Response.json(validProfile) });

    const profile = await fetchGoogleProfile("code", REDIRECT_URI);

    assert.deepEqual(profile, { providerUserId: "109876543210", email: "user@example.com" });
  });

  it("토큰 교환에 client_secret과 redirect_uri를 보내고 프로필 조회에 Bearer 토큰을 쓴다", async () => {
    const calls = mockGoogleFetch({ profileResponse: Response.json(validProfile) });

    await fetchGoogleProfile("auth-code", REDIRECT_URI);

    const body = calls[0]?.init?.body as URLSearchParams;
    assert.equal(body.get("code"), "auth-code");
    assert.equal(body.get("client_id"), "test-client-id");
    assert.equal(body.get("client_secret"), "test-client-secret");
    assert.equal(body.get("redirect_uri"), REDIRECT_URI);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.deepEqual(calls[1]?.init?.headers, { Authorization: "Bearer google-token" });
  });

  it("email_verified가 boolean true가 아니면 SOCIAL_AUTH_FAILED다", async () => {
    mockGoogleFetch({
      profileResponse: Response.json({ ...validProfile, email_verified: "true" }),
    });

    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("이메일이 검증되지 않았으면 SOCIAL_AUTH_FAILED다", async () => {
    mockGoogleFetch({ profileResponse: Response.json({ ...validProfile, email_verified: false }) });

    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("email_verified가 없으면 SOCIAL_AUTH_FAILED다", async () => {
    mockGoogleFetch({
      profileResponse: Response.json({ sub: "1", email: "user@example.com" }),
    });

    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("이메일이나 sub가 없으면 SOCIAL_AUTH_FAILED다", async () => {
    mockGoogleFetch({ profileResponse: Response.json({ sub: "1", email_verified: true }) });
    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );

    mockGoogleFetch({
      profileResponse: Response.json({ email: "user@example.com", email_verified: true }),
    });
    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("토큰 응답에 access_token이 없으면 SOCIAL_AUTH_FAILED다", async () => {
    mockGoogleFetch({ tokenResponse: Response.json({}) });

    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("구글 4xx 응답은 SOCIAL_AUTH_FAILED다", async () => {
    mockGoogleFetch({ tokenResponse: Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );

    mockGoogleFetch({ profileResponse: Response.json({}, { status: 401 }) });
    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("구글 5xx 응답은 INTERNAL_SERVER_ERROR다", async () => {
    mockGoogleFetch({ tokenResponse: Response.json({}, { status: 503 }) });
    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("INTERNAL_SERVER_ERROR"),
    );

    mockGoogleFetch({ profileResponse: Response.json({}, { status: 500 }) });
    await assert.rejects(
      fetchGoogleProfile("code", REDIRECT_URI),
      isAppError("INTERNAL_SERVER_ERROR"),
    );
  });
});
