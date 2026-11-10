import { Router } from "express";
import { getNotificationsController } from "../controllers/notification-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const notificationRouter = Router();

// 팟오너·팟트너의 알림 목록 조회
notificationRouter.get("/", authenticate, authorize("OWNER", "SITTER"), getNotificationsController);
