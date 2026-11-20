import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import * as profileService from "../services/profile-service.js";
import {
  validateUpdateOwnerProfile,
  validateCreateSitterProfile,
  validateUpdateSitterProfile,
} from "../validators/profile-validator.js";

export async function getOwnerProfileController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const profile = await profileService.getOwnerProfile(req.user.id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function updateOwnerProfileController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = validateUpdateOwnerProfile(req.body, { id: req.user.id, role: req.user.role });
    const profile = await profileService.updateOwnerProfile(req.user.id, input);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function getSitterProfileController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const profile = await profileService.getSitterProfile(req.user.id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function updateSitterProfileController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = validateUpdateSitterProfile(req.body, { id: req.user.id, role: req.user.role });
    const profile = await profileService.updateSitterProfile(req.user.id, input);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function createSitterProfileController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = validateCreateSitterProfile(req.body, { id: req.user.id, role: req.user.role });
    const profile = await profileService.createSitterProfile(req.user.id, input);
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
}

export async function getSitterMyPageController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await profileService.getSitterMyPage(req.user.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
