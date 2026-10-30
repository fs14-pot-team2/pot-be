import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { isUserRole, type UserRole } from "../types/auth.js";
import { parseBigId } from "./bigint.js";

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

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtRefreshSecret, {
      algorithms: ["HS256"],
    });
    if (typeof decoded === "string") return null;

    const { sub, role } = decoded;
    if (typeof sub !== "string" || parseBigId(sub) === null || !isUserRole(role)) {
      return null;
    }
    return { sub, role };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return null;
    }
    throw error;
  }
}
