import type { NextFunction, Request, Response } from "express";

import AppError from "../errors/app-error.js";
import * as authService from "../services/auth-service.js";
import {
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from "../utils/auth-cookie.js";
import { serializeBigInt } from "../utils/bigint.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { validateLogin, validateSignup } from "../validators/auth-validator.js";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateSignup(req.body);
    const user = await authService.signup(input);

    const payload = { sub: user.id.toString(), role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(res, refreshToken);
    res.status(201).json(serializeBigInt({ accessToken, user }));
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateLogin(req.body);
    const user = await authService.login(input);

    const payload = { sub: user.id.toString(), role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(res, refreshToken);
    res.status(200).json(serializeBigInt({ accessToken, user }));
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response) {
  clearRefreshTokenCookie(res);
  res.status(200).json({ message: "로그아웃되었습니다." });
}

export function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getRefreshTokenFromCookie(req);
    const payload = token ? verifyRefreshToken(token) : null;
    if (!payload) {
      throw new AppError("REFRESH_TOKEN_INVALID");
    }

    const accessToken = signAccessToken({ sub: payload.sub, role: payload.role });
    res.status(200).json({ accessToken });
  } catch (error) {
    next(error);
  }
}
