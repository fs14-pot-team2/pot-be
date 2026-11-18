import AppError from "../errors/app-error.js";
import { isUserRole, type UserRole } from "../types/auth.js";

export type KakaoLoginInput = {
  role: UserRole;
  code: string;
  redirectUri: string;
};

// 카카오 인가 코드 교환에는 http, https 리다이렉트 URI만 사용할 수 있다.
function isHttpUrl(value: string) {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

export function validateKakaoLogin(body: unknown): KakaoLoginInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }
  const { role, code, redirectUri } = body as Record<string, unknown>;

  if (!isUserRole(role)) throw new AppError("INVALID_USER_ROLE");
  if (typeof code !== "string" || code.trim().length === 0) throw new AppError("INVALID_REQUEST");
  if (typeof redirectUri !== "string" || !isHttpUrl(redirectUri)) {
    throw new AppError("INVALID_REQUEST");
  }

  return { role, code, redirectUri };
}
