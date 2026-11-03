import { Router } from "express";
import {
  createCareRequestController,
  getActiveCareRequestController,
  getReceivedCareRequestsController,
  updateCareRequestController,
} from "../controllers/care-request-controller.js";
import { createDesignatedRequestController } from "../controllers/designated-request-controller.js";
import { ignoreCareRequestController } from "../controllers/ignored-request-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const careRequestRouter = Router();

// 팟오너의 활성 돌봄 요청 조회
careRequestRouter.get(
  "/me/active",
  authenticate,
  authorize("OWNER"),
  getActiveCareRequestController,
);

// 팟오너 돌봄 요청 생성
careRequestRouter.post("/", authenticate, authorize("OWNER"), createCareRequestController);

// 팟오너의 돌봄 요청 수정
careRequestRouter.patch(
  "/:careRequestId",
  authenticate,
  authorize("OWNER"),
  updateCareRequestController,
);

// 팟오너의 지정 요청 생성
careRequestRouter.post(
  "/:careRequestId/designated-requests",
  authenticate,
  authorize("OWNER"),
  createDesignatedRequestController,
);

// 팟트너의 받은 돌봄 요청 목록 조회
careRequestRouter.get(
  "/received",
  authenticate,
  authorize("SITTER"),
  getReceivedCareRequestsController,
);

// 팟트너의 공개 돌봄 요청 숨김 처리
careRequestRouter.post(
  "/:careRequestId/ignore",
  authenticate,
  authorize("SITTER"),
  ignoreCareRequestController,
);
