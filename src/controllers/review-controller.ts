import type { NextFunction, Request, Response } from "express";
import * as reviewService from "../services/review-service.js";
import { validatePagination } from "../validators/pagination-validator.js";
import { validateSitterIdParam } from "../validators/sitter-validator.js";

export async function getSitterReviewsController(req: Request, res: Response, next: NextFunction) {
  try {
    const sitterId = validateSitterIdParam(req.params.sitterId);
    const { page, pageSize } = validatePagination(req.query.page, req.query.pageSize);
    const result = await reviewService.getSitterReviews(sitterId, page, pageSize);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
