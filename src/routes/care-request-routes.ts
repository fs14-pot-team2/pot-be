import { Router } from "express";
import {
  createCareRequestController,
  getActiveCareRequestController,
  updateCareRequestController,
} from "../controllers/care-request-controller.js";
import { authenticate, authorize } from "../middlewares/auth.js";

export const careRequestRouter = Router();

// 팟오너 돌봄 요청 생성
careRequestRouter.post("/", authenticate, authorize("OWNER"), createCareRequestController);

// 팟오너의 활성 돌봄 요청 조회
careRequestRouter.get(
  "/me/active",
  authenticate,
  authorize("OWNER"),
  getActiveCareRequestController,
);

// 팟오너의 돌봄 요청 수정
careRequestRouter.patch(
  "/:careRequestId",
  authenticate,
  authorize("OWNER"),
  updateCareRequestController,
);
