import type { NextFunction, Request, Response } from "express";

import * as imageService from "../services/image-service.js";
import { validatePresignedUrlRequest } from "../validators/image-validator.js";

export async function issueProfileImageUrlController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = validatePresignedUrlRequest(req.body);
    const result = await imageService.createProfileImagePresignedUrl(
      { id: req.user!.id, role: req.user!.role },
      input,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}
