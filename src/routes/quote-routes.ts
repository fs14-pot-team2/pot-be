import { Router } from "express";
import {
  confirmQuoteController,
  getQuoteDetailController,
  getSentQuotesController,
  updateQuoteController,
} from "../controllers/quote-controller.js";
import { authorize } from "../middlewares/auth-middleware.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const quoteRouter = Router();

// 팟오너
// 견적 확정
quoteRouter.patch(
  "/:quoteId/confirm",
  withAuthentication(confirmQuoteController, authorize("OWNER")),
);

// 팟오너·팟트너
// 견적 상세 조회
quoteRouter.get("/:quoteId", withAuthentication(getQuoteDetailController));

// 팟트너
// 보낸 견적 목록 조회
quoteRouter.get("/me/sent", withAuthentication(getSentQuotesController, authorize("SITTER")));

// 견적 수정
quoteRouter.patch("/:quoteId", withAuthentication(updateQuoteController, authorize("SITTER")));
