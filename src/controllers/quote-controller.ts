import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import {
  createQuote,
  getQuoteDetail,
  getSentQuotes,
  updateQuoteService,
} from "../services/quote-service.js";
import {
  validateCreateQuote,
  validateSentQuotesQuery,
  validateUpdateQuote,
} from "../validators/quote-validator.js";
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

// 팟오너·팟트너의 견적 상세 조회
export async function getQuoteDetailController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const quoteId = parseBigId(req.params.quoteId);

  if (quoteId === null) {
    throw new AppError("INVALID_ID");
  }

  const quoteDetail = await getQuoteDetail(quoteId, req.user);

  res.status(200).json(serializeBigInt(quoteDetail));
}

// 팟트너가 보낸 견적 목록 조회
export async function getSentQuotesController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const { page, pageSize, confirmedOnly } = validateSentQuotesQuery(
    req.query.page,
    req.query.pageSize,
    req.query.confirmedOnly,
  );

  const sentQuotes = await getSentQuotes(sitterId, page, pageSize, confirmedOnly);

  res.status(200).json(serializeBigInt(sentQuotes));
}
