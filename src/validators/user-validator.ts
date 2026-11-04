import AppError from "../errors/app-error.js";

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
