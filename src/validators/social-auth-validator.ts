import AppError from "../errors/app-error.js";
import { isUserRole, type UserRole } from "../types/auth.js";
import { validatePassword } from "./auth-validator.js";

export type KakaoLoginInput = {
  role: UserRole;
  code: string;
  redirectUri: string;
};

export type GoogleLoginInput = KakaoLoginInput;

// 소셜 인가 코드 교환에는 http, https 리다이렉트 URI만 사용할 수 있다.
export function isHttpUrl(value: string) {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

function validateCodeAndRedirectUri(code: unknown, redirectUri: unknown) {
  if (typeof code !== "string" || code.trim().length === 0) throw new AppError("INVALID_REQUEST");
  if (typeof redirectUri !== "string" || !isHttpUrl(redirectUri)) {
    throw new AppError("INVALID_REQUEST");
  }
  return { code, redirectUri };
}

function validateSocialLogin(body: unknown): KakaoLoginInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }
  const { role, code, redirectUri } = body as Record<string, unknown>;

  if (!isUserRole(role)) throw new AppError("INVALID_USER_ROLE");

  return { role, ...validateCodeAndRedirectUri(code, redirectUri) };
}

export function validateKakaoLogin(body: unknown): KakaoLoginInput {
  return validateSocialLogin(body);
}

export function validateGoogleLogin(body: unknown): GoogleLoginInput {
  return validateSocialLogin(body);
}

export type KakaoSignupInput = { password: string };

export function validateKakaoSignup(body: unknown): KakaoSignupInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }
  const { password } = body as Record<string, unknown>;

  return { password: validatePassword(password) };
}

export type KakaoLinkInput = { code: string; redirectUri: string };

export function validateKakaoLink(body: unknown): KakaoLinkInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }
  const { code, redirectUri } = body as Record<string, unknown>;

  return validateCodeAndRedirectUri(code, redirectUri);
}

export const validateGoogleSignup = validateKakaoSignup;
export type GoogleLinkInput = KakaoLinkInput;

export function validateGoogleLink(body: unknown): GoogleLinkInput {
  return validateKakaoLink(body);
}
