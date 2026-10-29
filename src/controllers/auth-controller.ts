import type { NextFunction, Request, Response } from "express";

import * as authService from "../services/auth-service.js";
import { serializeBigInt } from "../utils/bigint.js";
import { validateSignup } from "../validators/auth-validator.js";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateSignup(req.body);
    const user = await authService.signup(input);

    res.status(201).json(serializeBigInt(user));
  } catch (error) {
    next(error);
  }
}
