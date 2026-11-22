import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { validateUpdateMe, validateVerifyPassword } from "../validators/user-validator.js";

import * as userService from "../services/user-service.js";
import { serializeBigInt } from "../utils/bigint.js";
import { clearReauthCookie, setReauthCookie } from "../utils/auth-cookie.js";
import { signReauthToken } from "../utils/jwt.js";

export async function getMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const user = await userService.getMe(req.user.id);
    res.status(200).json(serializeBigInt(user));
  } catch (error) {
    next(error);
  }
}

export async function verifyPassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { password } = validateVerifyPassword(req.body);
    const result = await userService.verifyMyPassword(req.user.id, password);
    setReauthCookie(res, signReauthToken(req.user.id.toString()));
    res.status(200).json(serializeBigInt(result));
  } catch (error) {
    next(error);
  }
}

export async function updateMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const input = validateUpdateMe(req.body);
    const result = await userService.updateMe(req.user.id, input);
    clearReauthCookie(res);
    res.status(200).json(serializeBigInt(result));
  } catch (error) {
    next(error);
  }
}
