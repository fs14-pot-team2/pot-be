import { env } from "../config/env.js";
import AppError from "../errors/app-error.js";

const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_USER_ME_URL = "https://kapi.kakao.com/v2/user/me";
const REQUEST_TIMEOUT_MS = 5000;

export type KakaoProfile = {
  providerUserId: string;
  email: string;
};

type KakaoTokenResponse = { access_token?: unknown };
type KakaoUserResponse = {
  id?: unknown;
  kakao_account?: { email?: unknown; is_email_valid?: unknown; is_email_verified?: unknown };
};

// 인가 코드를 카카오 토큰으로 교환하고, 사용자 ID와 이메일을 조회한다.
// 카카오 4xx 응답이거나 필수 정보가 없으면 SOCIAL_AUTH_FAILED,
// 카카오 서버 오류(5xx)·네트워크 오류·타임아웃은 INTERNAL_SERVER_ERROR
export async function fetchKakaoProfile(code: string, redirectUri: string): Promise<KakaoProfile> {
  const accessToken = await exchangeCodeForToken(code, redirectUri);
  return fetchProfile(accessToken);
}

// 카카오 4xx는 인증 실패(코드 만료·거부 등), 그 외(5xx 등)는 외부 서비스 장애로 처리
function assertKakaoResponseOk(response: Response) {
  if (response.ok) return;
  if (response.status >= 400 && response.status < 500) {
    throw new AppError("SOCIAL_AUTH_FAILED");
  }
  throw new AppError("INTERNAL_SERVER_ERROR");
}

async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.kakaoRestApiKey,
    redirect_uri: redirectUri,
    code,
  });
  if (env.kakaoClientSecret) body.set("client_secret", env.kakaoClientSecret);

  const response = await fetch(KAKAO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assertKakaoResponseOk(response);

  const data = (await response.json()) as KakaoTokenResponse;
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new AppError("SOCIAL_AUTH_FAILED");
  }
  return data.access_token;
}

async function fetchProfile(accessToken: string): Promise<KakaoProfile> {
  const response = await fetch(KAKAO_USER_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assertKakaoResponseOk(response);

  const data = (await response.json()) as KakaoUserResponse;
  const account = data.kakao_account;
  const email = account?.email;

  // 이메일은 필수 동의항목이며, 검증된 이메일만 신뢰한다 (미검증 이메일로 기존 계정 선점 방지)
  if (
    (typeof data.id !== "number" && typeof data.id !== "string") ||
    typeof email !== "string" ||
    email.length === 0 ||
    account?.is_email_valid !== true ||
    account?.is_email_verified !== true
  ) {
    throw new AppError("SOCIAL_AUTH_FAILED");
  }

  return { providerUserId: String(data.id), email };
}
