import type { NextFunction, Request, Response } from "express";
import * as reviewService from "../services/review-service.js";
import { validatePagination } from "../validators/pagination-validator.js";
import { validateSitterIdParam } from "../validators/sitter-validator.js";
import {
  validateCareRequestIdParam,
  validateCreateReviewBody,
} from "../validators/review-validator.js";
import AppError from "../errors/app-error.js";

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

export async function createReviewController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError("UNAUTHORIZED");
    }

    const careRequestId = validateCareRequestIdParam(req.params.careRequestId);
    const input = validateCreateReviewBody(req.body);
    const result = await reviewService.createReview(req.user.id, careRequestId, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getWritableReviewsController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      throw new AppError("UNAUTHORIZED");
    }

    const { page, pageSize } = validatePagination(req.query.page, req.query.pageSize);
    const result = await reviewService.getWritableReviews(req.user.id, page, pageSize);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getMyReviewsController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError("UNAUTHORIZED");
    }

    const { page, pageSize } = validatePagination(req.query.page, req.query.pageSize);
    const result = await reviewService.getMyReviews(req.user.id, page, pageSize);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
