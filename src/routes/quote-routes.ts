import { Router } from "express";
import {
  getQuoteDetailController,
  updateQuoteController,
} from "../controllers/quote-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const quoteRouter = Router();

// 팟오너·팟트너
// 견적 상세 조회
quoteRouter.get("/:quoteId", authenticate, getQuoteDetailController);

// 팟트너
// 견적 수정
quoteRouter.patch("/:quoteId", authenticate, authorize("SITTER"), updateQuoteController);
