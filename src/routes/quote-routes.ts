import { Router } from "express";
import {
  getQuoteDetailController,
  getSentQuotesController,
  updateQuoteController,
} from "../controllers/quote-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const quoteRouter = Router();

// 팟오너·팟트너
// 견적 상세 조회
quoteRouter.get("/:quoteId", authenticate, getQuoteDetailController);

// 팟트너
// 보낸 견적 목록 조회
quoteRouter.get("/me/sent", authenticate, authorize("SITTER"), getSentQuotesController);

// 견적 수정
quoteRouter.patch("/:quoteId", authenticate, authorize("SITTER"), updateQuoteController);
