import { env } from "../config/env.js";
import AppError from "../errors/app-error.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REQUEST_TIMEOUT_MS = 5000;

export type GoogleProfile = {
  providerUserId: string;
  email: string;
};

type GoogleTokenResponse = { access_token?: unknown };
type GoogleUserInfoResponse = { sub?: unknown; email?: unknown; email_verified?: unknown };

// 인가 코드를 구글 토큰으로 교환하고, 사용자 ID(sub)와 이메일을 조회한다.
// 구글 4xx 응답이거나 필수 정보가 없으면 SOCIAL_AUTH_FAILED,
// 구글 서버 오류(5xx)·네트워크 오류·타임아웃은 INTERNAL_SERVER_ERROR
export async function fetchGoogleProfile(
  code: string,
  redirectUri: string,
): Promise<GoogleProfile> {
  const accessToken = await exchangeCodeForToken(code, redirectUri);
  return fetchProfile(accessToken);
}

// 구글 4xx는 인증 실패(코드 만료·거부 등), 그 외(5xx 등)는 외부 서비스 장애로 처리
function assertGoogleResponseOk(response: Response) {
  if (response.ok) return;
  if (response.status >= 400 && response.status < 500) {
    throw new AppError("SOCIAL_AUTH_FAILED");
  }
  throw new AppError("INTERNAL_SERVER_ERROR");
}

async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assertGoogleResponseOk(response);

  const data = (await response.json()) as GoogleTokenResponse;
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new AppError("SOCIAL_AUTH_FAILED");
  }
  return data.access_token;
}

async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assertGoogleResponseOk(response);

  const data = (await response.json()) as GoogleUserInfoResponse;
  const { sub, email, email_verified: emailVerified } = data;

  // 검증된 이메일만 신뢰한다 (미검증 이메일로 기존 계정 선점 방지)
  if (
    typeof sub !== "string" ||
    sub.length === 0 ||
    typeof email !== "string" ||
    email.length === 0 ||
    emailVerified !== true
  ) {
    throw new AppError("SOCIAL_AUTH_FAILED");
  }

  return { providerUserId: sub, email: email.toLowerCase() };
}
