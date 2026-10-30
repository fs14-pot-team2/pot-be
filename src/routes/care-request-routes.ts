import { Router } from "express";
import { createCareRequestController } from "../controllers/care-request-controller.js";
import { authenticate, authorize } from "../middlewares/auth.js";

export const careRequestRouter = Router();

// 팟오너 돌봄 요청 생성
careRequestRouter.post("/", authenticate, authorize("OWNER"), createCareRequestController);
