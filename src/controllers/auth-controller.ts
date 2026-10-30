import type { NextFunction, Request, Response } from "express";

import * as authService from "../services/auth-service.js";
import { setRefreshTokenCookie } from "../utils/auth-cookie.js";
import { serializeBigInt } from "../utils/bigint.js";
import { signAccessToken, signRefreshToken } from "../utils/jwt.js";
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
