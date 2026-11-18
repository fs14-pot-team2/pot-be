import { Router } from "express";
import { publishInternalNotificationController } from "../controllers/internal-sse-controller.js";
import { authenticateInternalSse } from "../middlewares/internal-sse-auth-middleware.js";

export const internalSseRouter = Router();

// Lambda의 인증된 내부 요청으로 알림 SSE 이벤트 전파
internalSseRouter.post(
  "/notifications",
  authenticateInternalSse,
  publishInternalNotificationController,
);
