import AppError from "../errors/app-error.js";
import { parseBigId } from "../utils/bigint.js";

export interface CreateReviewInput {
  rating: number;
  content: string;
}

export function validateCareRequestIdParam(value: unknown): bigint {
  const id = parseBigId(value);
  if (id === null) throw new AppError("INVALID_ID");
  return id;
}

export function validateCreateReviewBody(body: unknown): CreateReviewInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { rating, content } = body as Record<string, unknown>;

  if (rating === undefined || content === undefined) {
    throw new AppError("INVALID_REQUEST");
  }

  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("INVALID_REVIEW_RATING");
  }

  // 문자 수 제한은 공백 제외 기준, 저장은 원문 유지
  if (typeof content !== "string") {
    throw new AppError("INVALID_REVIEW_CONTENT");
  }
  const contentLength = content.replace(/\s/g, "").length;
  if (contentLength < 1 || contentLength > 150) {
    throw new AppError("INVALID_REVIEW_CONTENT");
  }

  return { rating, content };
}
