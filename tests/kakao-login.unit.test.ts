import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { fetchKakaoProfile } from "../src/utils/kakao-client.js";
import { validateKakaoLogin } from "../src/validators/social-auth-validator.js";

const originalFetch = globalThis.fetch;

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

// 토큰 교환 요청과 프로필 조회 요청을 URL로 구분해 응답을 돌려준다.
function mockKakaoFetch(options: { tokenResponse?: Response; profileResponse?: Response }) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("kauth.kakao.com")) {
      return options.tokenResponse ?? Response.json({ access_token: "kakao-token" });
    }
    return options.profileResponse ?? Response.json({});
  }) as typeof fetch;
}

const validProfile = {
  id: 12345,
  kakao_account: { email: "user@example.com", is_email_valid: true, is_email_verified: true },
};

describe("카카오 로그인 요청 검증", () => {
  const valid = { role: "OWNER", code: "auth-code", redirectUri: "http://localhost:3000/callback" };

  it("올바른 요청은 그대로 반환한다", () => {
    assert.deepEqual(validateKakaoLogin(valid), valid);
  });

  it("body가 객체가 아니면 INVALID_REQUEST다", () => {
    assert.throws(() => validateKakaoLogin(null), isAppError("INVALID_REQUEST"));
    assert.throws(() => validateKakaoLogin([]), isAppError("INVALID_REQUEST"));
  });

  it("role이 올바르지 않으면 INVALID_USER_ROLE이다", () => {
    assert.throws(
      () => validateKakaoLogin({ ...valid, role: "ADMIN" }),
      isAppError("INVALID_USER_ROLE"),
    );
  });

  it("code가 비었거나 문자열이 아니면 INVALID_REQUEST다", () => {
    assert.throws(
      () => validateKakaoLogin({ ...valid, code: "  " }),
      isAppError("INVALID_REQUEST"),
    );
    assert.throws(() => validateKakaoLogin({ ...valid, code: 1 }), isAppError("INVALID_REQUEST"));
  });

  it("redirectUri가 URL 형식이 아니면 INVALID_REQUEST다", () => {
    assert.throws(
      () => validateKakaoLogin({ ...valid, redirectUri: "not-a-url" }),
      isAppError("INVALID_REQUEST"),
    );
  });

  it("redirectUri가 http, https 스킴이 아니면 INVALID_REQUEST다", () => {
    for (const redirectUri of [
      "javascript:alert(1)",
      "ftp://example.com/callback",
      "kakao123://oauth",
    ]) {
      assert.throws(
        () => validateKakaoLogin({ ...valid, redirectUri }),
        isAppError("INVALID_REQUEST"),
      );
    }
  });

  it("redirectUri가 https 스킴이면 허용한다", () => {
    const input = { ...valid, redirectUri: "https://example.com/auth/kakao/callback" };

    assert.deepEqual(validateKakaoLogin(input), input);
  });
});

describe("카카오 프로필 조회", () => {
  beforeEach(() => {
    process.env.KAKAO_REST_API_KEY = "test-rest-api-key";
    delete process.env.KAKAO_CLIENT_SECRET;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("이메일은 소문자로 정규화해 반환한다", async () => {
    mockKakaoFetch({
      profileResponse: Response.json({
        id: 12345,
        kakao_account: {
          email: "User@Example.COM",
          is_email_valid: true,
          is_email_verified: true,
        },
      }),
    });

    const profile = await fetchKakaoProfile("code", "http://localhost:3000/callback");

    assert.equal(profile.email, "user@example.com");
  });

  it("카카오 서버 오류(5xx)면 INTERNAL_SERVER_ERROR다", async () => {
    mockKakaoFetch({ tokenResponse: new Response("{}", { status: 503 }) });

    await assert.rejects(
      fetchKakaoProfile("code", "http://localhost:3000/callback"),
      isAppError("INTERNAL_SERVER_ERROR"),
    );
  });

  it("프로필 조회가 5xx면 INTERNAL_SERVER_ERROR다", async () => {
    mockKakaoFetch({ profileResponse: new Response("{}", { status: 500 }) });

    await assert.rejects(
      fetchKakaoProfile("code", "http://localhost:3000/callback"),
      isAppError("INTERNAL_SERVER_ERROR"),
    );
  });

  it("정상 응답이면 providerUserId와 email을 반환한다", async () => {
    mockKakaoFetch({ profileResponse: Response.json(validProfile) });

    const profile = await fetchKakaoProfile("code", "http://localhost:3000/callback");

    assert.deepEqual(profile, { providerUserId: "12345", email: "user@example.com" });
  });

  it("토큰 교환이 실패하면 SOCIAL_AUTH_FAILED다", async () => {
    mockKakaoFetch({ tokenResponse: new Response("{}", { status: 400 }) });

    await assert.rejects(
      fetchKakaoProfile("code", "http://localhost:3000/callback"),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("access_token이 없으면 SOCIAL_AUTH_FAILED다", async () => {
    mockKakaoFetch({ tokenResponse: Response.json({}) });

    await assert.rejects(
      fetchKakaoProfile("code", "http://localhost:3000/callback"),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("프로필 조회가 실패하면 SOCIAL_AUTH_FAILED다", async () => {
    mockKakaoFetch({ profileResponse: new Response("{}", { status: 401 }) });

    await assert.rejects(
      fetchKakaoProfile("code", "http://localhost:3000/callback"),
      isAppError("SOCIAL_AUTH_FAILED"),
    );
  });

  it("이메일이 없거나 검증되지 않았으면 SOCIAL_AUTH_FAILED다", async () => {
    const cases = [
      { id: 1, kakao_account: {} },
      {
        id: 1,
        kakao_account: { email: "a@b.com", is_email_valid: true, is_email_verified: false },
      },
      {
        id: 1,
        kakao_account: { email: "a@b.com", is_email_valid: false, is_email_verified: true },
      },
    ];

    for (const body of cases) {
      mockKakaoFetch({ profileResponse: Response.json(body) });

      await assert.rejects(
        fetchKakaoProfile("code", "http://localhost:3000/callback"),
        isAppError("SOCIAL_AUTH_FAILED"),
      );
    }
  });
});
