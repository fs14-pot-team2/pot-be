import { Router } from "express";
import {
  cancelCareRequestController,
  createCareRequestController,
  getActiveCareRequestController,
  getCareRequestQuotesHistoryController,
  getOpenCareRequestQuotesController,
  getReceivedCareRequestsController,
  updateCareRequestController,
} from "../controllers/care-request-controller.js";
import {
  createDesignatedRequestController,
  getRejectedRequestReasonController,
  getRejectedRequestsBySitterController,
  rejectDesignatedRequestController,
} from "../controllers/designated-request-controller.js";
import { ignoreCareRequestController } from "../controllers/ignored-request-controller.js";
import { createQuoteController } from "../controllers/quote-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";
import { createReviewController } from "../controllers/review-controller.js";

export const careRequestRouter = Router();

// 팟오너
// 활성 돌봄 요청 조회
careRequestRouter.get(
  "/me/active",
  authenticate,
  authorize("OWNER"),
  getActiveCareRequestController,
);

// 돌봄 요청의 견적 및 반려 현황 조회
careRequestRouter.get(
  "/me/active/quotes",
  authenticate,
  authorize("OWNER"),
  getOpenCareRequestQuotesController,
);

// 지난 돌봄 요청에 받은 견적 및 반려 조회
careRequestRouter.get(
  "/me/history/quotes",
  authenticate,
  authorize("OWNER"),
  getCareRequestQuotesHistoryController,
);

// 돌봄 요청 생성
careRequestRouter.post("/", authenticate, authorize("OWNER"), createCareRequestController);

// 돌봄 요청 수정
careRequestRouter.patch(
  "/:careRequestId",
  authenticate,
  authorize("OWNER"),
  updateCareRequestController,
);

// 돌봄 요청 취소
careRequestRouter.patch(
  "/:careRequestId/cancel",
  authenticate,
  authorize("OWNER"),
  cancelCareRequestController,
);

// 지정 요청 생성
careRequestRouter.post(
  "/:careRequestId/designated-requests",
  authenticate,
  authorize("OWNER"),
  createDesignatedRequestController,
);

// 반려 사유 조회
careRequestRouter.get(
  "/rejected-requests/:rejectedRequestId",
  authenticate,
  authorize("OWNER"),
  getRejectedRequestReasonController,
);

// 팟트너
// 지정 요청 반려
careRequestRouter.post(
  "/designated-requests/:designatedRequestId/reject",
  authenticate,
  authorize("SITTER"),
  rejectDesignatedRequestController,
);

// 받은 돌봄 요청 목록 조회
careRequestRouter.get(
  "/received",
  authenticate,
  authorize("SITTER"),
  getReceivedCareRequestsController,
);

// 공개 돌봄 요청 숨김 처리
careRequestRouter.post(
  "/:careRequestId/ignore",
  authenticate,
  authorize("SITTER"),
  ignoreCareRequestController,
);

// 견적 생성
careRequestRouter.post(
  "/:careRequestId/quotes",
  authenticate,
  authorize("SITTER"),
  createQuoteController,
);

// 반려 요청 이력 목록 조회
careRequestRouter.get(
  "/me/rejected",
  authenticate,
  authorize("SITTER"),
  getRejectedRequestsBySitterController,
);

// 리뷰 생성
careRequestRouter.post(
  "/:careRequestId/review",
  authenticate,
  authorize("OWNER"),
  createReviewController,
);
