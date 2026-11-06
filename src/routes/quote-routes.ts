import { Router } from "express";
import { updateQuoteController } from "../controllers/quote-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const quoteRouter = Router();

// 팟트너
// 견적 수정
quoteRouter.patch("/:quoteId", authenticate, authorize("SITTER"), updateQuoteController);
