import type { NextFunction, Request, Response } from "express";

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
