import AppError from "../errors/app-error.js";

export interface CreateQuoteInput {
  price: number;
  comment: string;
}

// 견적 생성 입력값 검증
export function validateCreateQuote(body: unknown): CreateQuoteInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { price, comment } = body as Record<string, unknown>;

  if (price === undefined || comment === undefined) {
    throw new AppError("INVALID_REQUEST");
  }

  if (typeof price !== "number" || !Number.isInteger(price) || price < 1000 || price >= 100000000) {
    throw new AppError("INVALID_QUOTE_PRICE");
  }

  if (typeof comment !== "string") {
    throw new AppError("INVALID_QUOTE_COMMENT");
  }

  const commentLength = comment.replace(/\s/g, "").length;

  if (commentLength < 10 || commentLength > 1000) {
    throw new AppError("INVALID_QUOTE_COMMENT");
  }

  return { price, comment };
}
