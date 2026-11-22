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
import { authorize } from "../middlewares/auth-middleware.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";
import { createReviewController } from "../controllers/review-controller.js";

export const careRequestRouter = Router();

// 팟오너
// 활성 돌봄 요청 조회
careRequestRouter.get(
  "/me/active",
  withAuthentication(getActiveCareRequestController, authorize("OWNER")),
);

// 돌봄 요청의 견적 및 반려 현황 조회
careRequestRouter.get(
  "/me/active/quotes",
  withAuthentication(getOpenCareRequestQuotesController, authorize("OWNER")),
);

// 지난 돌봄 요청에 받은 견적 및 반려 조회
careRequestRouter.get(
  "/me/history/quotes",
  withAuthentication(getCareRequestQuotesHistoryController, authorize("OWNER")),
);

// 돌봄 요청 생성
careRequestRouter.post("/", withAuthentication(createCareRequestController, authorize("OWNER")));

// 돌봄 요청 수정
careRequestRouter.patch(
  "/:careRequestId",
  withAuthentication(updateCareRequestController, authorize("OWNER")),
);

// 돌봄 요청 취소
careRequestRouter.patch(
  "/:careRequestId/cancel",
  withAuthentication(cancelCareRequestController, authorize("OWNER")),
);

// 지정 요청 생성
careRequestRouter.post(
  "/:careRequestId/designated-requests",
  withAuthentication(createDesignatedRequestController, authorize("OWNER")),
);

// 반려 사유 조회
careRequestRouter.get(
  "/rejected-requests/:rejectedRequestId",
  withAuthentication(getRejectedRequestReasonController, authorize("OWNER")),
);

// 팟트너
// 지정 요청 반려
careRequestRouter.post(
  "/designated-requests/:designatedRequestId/reject",
  withAuthentication(rejectDesignatedRequestController, authorize("SITTER")),
);

// 받은 돌봄 요청 목록 조회
careRequestRouter.get(
  "/received",
  withAuthentication(getReceivedCareRequestsController, authorize("SITTER")),
);

// 공개 돌봄 요청 숨김 처리
careRequestRouter.post(
  "/:careRequestId/ignore",
  withAuthentication(ignoreCareRequestController, authorize("SITTER")),
);

// 견적 생성
careRequestRouter.post(
  "/:careRequestId/quotes",
  withAuthentication(createQuoteController, authorize("SITTER")),
);

// 반려 요청 이력 목록 조회
careRequestRouter.get(
  "/me/rejected",
  withAuthentication(getRejectedRequestsBySitterController, authorize("SITTER")),
);

// 리뷰 생성
careRequestRouter.post(
  "/:careRequestId/review",
  withAuthentication(createReviewController, authorize("OWNER")),
);
