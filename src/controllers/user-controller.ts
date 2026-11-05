import type { NextFunction, Request, Response } from "express";
import { validateUpdateMe, validateVerifyPassword } from "../validators/user-validator.js";

import AppError from "../errors/app-error.js";
import * as userService from "../services/user-service.js";
import { serializeBigInt } from "../utils/bigint.js";

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");
    const user = await userService.getMe(req.user.id);
    res.status(200).json(serializeBigInt(user));
  } catch (error) {
    next(error);
  }
}

export async function verifyPassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");
    const { password } = validateVerifyPassword(req.body);
    const result = await userService.verifyMyPassword(req.user.id, password);
    res.status(200).json(serializeBigInt(result));
  } catch (error) {
    next(error);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");
    const input = validateUpdateMe(req.body);
    const result = await userService.updateMe(req.user.id, input);
    res.status(200).json(serializeBigInt(result));
  } catch (error) {
    next(error);
  }
}
