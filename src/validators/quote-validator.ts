import AppError from "../errors/app-error.js";

export interface CreateQuoteInput {
  price: number;
  comment: string;
}

export type UpdateQuoteInput = Partial<CreateQuoteInput>;

function validateQuotePrice(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value >= 100000000) {
    throw new AppError("INVALID_QUOTE_PRICE");
  }

  return value;
}

function validateQuoteComment(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("INVALID_QUOTE_COMMENT");
  }

  const commentLength = value.replace(/\s/g, "").length;

  if (commentLength < 10 || commentLength > 1000) {
    throw new AppError("INVALID_QUOTE_COMMENT");
  }

  return value;
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

  return {
    price: validateQuotePrice(price),
    comment: validateQuoteComment(comment),
  };
}

// 견적 수정 입력값 검증
export function validateUpdateQuote(body: unknown): UpdateQuoteInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const quoteData: UpdateQuoteInput = {};

  if ("price" in body) {
    quoteData.price = validateQuotePrice(body.price);
  }

  if ("comment" in body) {
    quoteData.comment = validateQuoteComment(body.comment);
  }

  return quoteData;
}
