import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import { createQuote, updateQuoteService } from "../services/quote-service.js";
import { validateCreateQuote, validateUpdateQuote } from "../validators/quote-validator.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";

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

// 팟트너의 견적 수정
export async function updateQuoteController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const quoteId = parseBigId(req.params.quoteId);

  if (quoteId === null) {
    throw new AppError("INVALID_ID");
  }

  const quoteData = validateUpdateQuote(req.body);
  const updatedQuote = await updateQuoteService(sitterId, quoteId, quoteData);

  const quoteResponse = {
    id: updatedQuote.id,
    careRequestId: updatedQuote.careRequestId,
    sitterId: updatedQuote.sitterId,
    type: updatedQuote.type,
    price: updatedQuote.price,
    comment: updatedQuote.comment,
    updatedAt: updatedQuote.updatedAt,
  };

  res.status(200).json(serializeBigInt(quoteResponse));
}
