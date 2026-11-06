import { prisma } from "../config/prisma.js";
import { QuoteType } from "../generated/prisma/enums.js";
import type { DbClient } from "../types/db.js";
import type { CreateQuoteInput } from "../validators/quote-validator.js";

// 공개 요청에 대한 견적 건수 조회
export function countGeneralQuotesByCareRequest(careRequestId: bigint, db: DbClient = prisma) {
  return db.quote.count({
    where: {
      careRequestId,
      type: QuoteType.GENERAL,
    },
  });
}

// 신규 견적 생성
export function insertQuote(
  careRequestId: bigint,
  sitterId: bigint,
  type: QuoteType,
  price: number,
  comment: string,
  db: DbClient = prisma,
) {
  return db.quote.create({
    data: {
      careRequestId,
      sitterId,
      type,
      price,
      comment,
    },
  });
}

// 견적 조회
export function findQuote(quoteId: bigint, db: DbClient = prisma) {
  return db.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      careRequestId: true,
      sitterId: true,
    },
  });
}

// 견적 수정
export function updateQuote(
  quoteId: bigint,
  quoteData: Partial<CreateQuoteInput>,
  db: DbClient = prisma,
) {
  return db.quote.update({
    where: { id: quoteId },
    data: quoteData,
  });
}
