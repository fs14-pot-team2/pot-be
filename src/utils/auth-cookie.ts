import type { Request, Response } from "express";

import { env } from "../config/env.js";
import { REAUTH_TOKEN_MAX_AGE_MS, REFRESH_TOKEN_MAX_AGE_MS } from "./jwt.js";

const REFRESH_COOKIE_NAME = "refreshToken";
const REAUTH_COOKIE_NAME = "reauthToken";

// FE에서 Next.js rewrites 프록시(same-origin)로 호출하므로 sameSite는 lax 유지 (발급/삭제 옵션은 항상 동일해야 함)
const baseOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax" as const,
});

export function setRefreshTokenCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(),
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
}

export function clearRefreshTokenCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions());
}

export function getRefreshTokenFromCookie(req: Request): string | undefined {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function setReauthCookie(res: Response, token: string) {
  res.cookie(REAUTH_COOKIE_NAME, token, {
    ...baseOptions(),
    maxAge: REAUTH_TOKEN_MAX_AGE_MS,
  });
}

export function clearReauthCookie(res: Response) {
  res.clearCookie(REAUTH_COOKIE_NAME, baseOptions());
}

export function getReauthTokenFromCookie(req: Request): string | undefined {
  const token = req.cookies?.[REAUTH_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}
