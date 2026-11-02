import type { NextFunction, Request, Response } from "express";
import * as profileService from "../services/profile-service.js";

export async function getOwnerProfileController(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await profileService.getOwnerProfile(req.user!.id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}
