import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import type { UserRole } from "../types/auth.js";

const ACCESS_TOKEN_EXPIRES_IN = "30m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type TokenPayload = { sub: string; role: UserRole };

export function signAccessToken(payload: TokenPayload) {
  return jwt.sign(payload, env.jwtAccessSecret, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

export function signRefreshToken(payload: TokenPayload) {
  return jwt.sign(payload, env.jwtRefreshSecret, {
    algorithm: "HS256",
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  });
}
