import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import { createQuote } from "../services/quote-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";
import { validateCreateQuote } from "../validators/quote-validator.js";

// 팟트너의 견적 생성
export async function createQuoteController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const careRequestId = parseBigId(req.params.careRequestId);

  if (careRequestId === null) {
    throw new AppError("INVALID_ID");
  }

  const { price, comment } = validateCreateQuote(req.body);

  const createdQuote = await createQuote(sitterId, careRequestId, price, comment);

  const quoteResponse = {
    id: createdQuote.id,
    careRequestId: createdQuote.careRequestId,
    sitterId: createdQuote.sitterId,
    type: createdQuote.type,
    price: createdQuote.price,
    comment: createdQuote.comment,
    createdAt: createdQuote.createdAt,
  };

  res.status(201).json(serializeBigInt(quoteResponse));
}
