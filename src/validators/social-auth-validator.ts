import AppError from "../errors/app-error.js";
import { isUserRole, type UserRole } from "../types/auth.js";

export type KakaoLoginInput = {
  role: UserRole;
  code: string;
  redirectUri: string;
};

export function validateKakaoLogin(body: unknown): KakaoLoginInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }
  const { role, code, redirectUri } = body as Record<string, unknown>;

  if (!isUserRole(role)) throw new AppError("INVALID_USER_ROLE");
  if (typeof code !== "string" || code.trim().length === 0) throw new AppError("INVALID_REQUEST");
  if (typeof redirectUri !== "string" || !URL.canParse(redirectUri)) {
    throw new AppError("INVALID_REQUEST");
  }

  return { role, code, redirectUri };
}
