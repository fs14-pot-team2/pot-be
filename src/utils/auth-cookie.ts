import type { Response } from "express";

import { env } from "../config/env.js";
import { REFRESH_TOKEN_MAX_AGE_MS } from "./jwt.js";

const REFRESH_COOKIE_NAME = "refreshToken";

// TODO: FE·BE 배포 구조 확정 후 sameSite 결정 (발급/삭제 옵션은 항상 동일해야 함)
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
