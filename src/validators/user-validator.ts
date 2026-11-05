import AppError from "../errors/app-error.js";
import { NICKNAME_REGEX, PASSWORD_REGEX } from "./auth-validator.js";

export interface VerifyPasswordInput {
  password: string;
}

// 비어 있지 않은 문자열인지만 확인
export function validateVerifyPassword(body: unknown): VerifyPasswordInput {
  if (typeof body !== "object" || body === null) {
    throw new AppError("INVALID_REQUEST");
  }

  const { password } = body as Record<string, unknown>;
  if (typeof password !== "string" || password.length === 0) {
    throw new AppError("INVALID_REQUEST");
  }

  return { password };
}

export interface UpdateMeInput {
  nickname?: string;
  password?: string;
}

// 전달된 필드만 검증 (email 등 그 외 필드는 무시)
export function validateUpdateMe(body: unknown): UpdateMeInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { nickname, password } = body as Record<string, unknown>;
  const input: UpdateMeInput = {};

  if (nickname !== undefined) {
    if (typeof nickname !== "string" || !NICKNAME_REGEX.test(nickname)) {
      throw new AppError("INVALID_NICKNAME_FORMAT");
    }
    input.nickname = nickname;
  }
  if (password !== undefined) {
    if (typeof password !== "string" || !PASSWORD_REGEX.test(password)) {
      throw new AppError("INVALID_PASSWORD_FORMAT");
    }
    input.password = password;
  }

  return input;
}
