import AppError from "../errors/app-error.js";
import { parseBigId } from "../utils/bigint.js";

export interface CreateReviewInput {
  rating: number;
  content: string;
}

export interface UpdateReviewInput {
  rating?: number;
  content?: string;
}

export function validateCareRequestIdParam(value: unknown): bigint {
  const id = parseBigId(value);
  if (id === null) throw new AppError("INVALID_ID");
  return id;
}

export function validateReviewIdParam(value: unknown): bigint {
  const id = parseBigId(value);
  if (id === null) throw new AppError("INVALID_ID");
  return id;
}

function validateRating(rating: unknown): number {
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("INVALID_REVIEW_RATING");
  }
  return rating;
}

// 문자 수 제한은 공백 제외 기준, 저장은 원문 유지
function validateContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new AppError("INVALID_REVIEW_CONTENT");
  }
  const contentLength = content.replace(/\s/g, "").length;
  if (contentLength < 1 || contentLength > 150) {
    throw new AppError("INVALID_REVIEW_CONTENT");
  }
  return content;
}

export function validateCreateReviewBody(body: unknown): CreateReviewInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { rating, content } = body as Record<string, unknown>;

  if (rating === undefined || content === undefined) {
    throw new AppError("INVALID_REQUEST");
  }

  return { rating: validateRating(rating), content: validateContent(content) };
}

export function validateUpdateReviewBody(body: unknown): UpdateReviewInput {
  // body 없이 호출해도 허용 (실제 수정 내용이 없어도 요청 허용 정책)
  const source = body ?? {};

  if (typeof source !== "object" || Array.isArray(source)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { rating, content } = source as Record<string, unknown>;
  const input: UpdateReviewInput = {};

  if (rating !== undefined) input.rating = validateRating(rating);
  if (content !== undefined) input.content = validateContent(content);

  return input;
}
