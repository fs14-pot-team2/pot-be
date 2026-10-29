import type { NextFunction, Request, Response } from "express";

import * as authService from "../services/auth-service.js";
import { serializeBigInt } from "../utils/bigint.js";
import { REFRESH_TOKEN_MAX_AGE_MS, signAccessToken, signRefreshToken } from "../utils/jwt.js";
import { validateSignup } from "../validators/auth-validator.js";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateSignup(req.body);
    const user = await authService.signup(input);

    const payload = { sub: user.id.toString(), role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // TODO: FE·BE 배포 구조 확정 후 결정
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });

    res.status(201).json(serializeBigInt({ accessToken, user }));
  } catch (error) {
    next(error);
  }
}
