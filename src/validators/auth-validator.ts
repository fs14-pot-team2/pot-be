import AppError from "../errors/app-error.js";
import { isUserRole, type UserRole } from "../types/auth.js";

export interface SignupInput {
  email: string;
  password: string;
  nickname: string;
  role: UserRole;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICKNAME_REGEX = /^[가-힣a-zA-Z0-9]{2,7}$/;
const PASSWORD_REGEX = /^[A-Za-z0-9!@#$]{8,20}$/;

export function validateSignup(body: unknown): SignupInput {
  if (typeof body !== "object" || body === null) {
    throw new AppError("INVALID_REQUEST");
  }

  const { email, password, nickname, role } = body as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    throw new AppError("INVALID_EMAIL_FORMAT");
  }
  if (typeof nickname !== "string" || !NICKNAME_REGEX.test(nickname)) {
    throw new AppError("INVALID_NICKNAME_FORMAT");
  }
  if (typeof password !== "string" || !PASSWORD_REGEX.test(password)) {
    throw new AppError("INVALID_PASSWORD_FORMAT");
  }
  if (!isUserRole(role)) {
    throw new AppError("INVALID_USER_ROLE");
  }

  return {
    email: email.toLowerCase(),
    password,
    nickname,
    role,
  };
}
