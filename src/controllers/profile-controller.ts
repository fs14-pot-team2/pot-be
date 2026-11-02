import type { NextFunction, Request, Response } from "express";
import * as profileService from "../services/profile-service.js";
import { validateUpdateOwnerProfile } from "../validators/profile-validator.js";

export async function getOwnerProfileController(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await profileService.getOwnerProfile(req.user!.id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function updateOwnerProfileController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = validateUpdateOwnerProfile(req.body);
    const profile = await profileService.updateOwnerProfile(req.user!.id, input);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function getSitterProfileController(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await profileService.getSitterProfile(req.user!.id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}
