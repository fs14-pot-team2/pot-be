import { Router } from "express";
import {
  getNotificationsController,
  hasUnreadNotificationController,
  markNotificationAsReadController,
} from "../controllers/notification-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const notificationRouter = Router();

// 팟오너·팟트너
// 알림 목록 조회
notificationRouter.get("/", authenticate, authorize("OWNER", "SITTER"), getNotificationsController);

// 미확인 알림 존재 여부 조회
notificationRouter.get(
  "/unread",
  authenticate,
  authorize("OWNER", "SITTER"),
  hasUnreadNotificationController,
);

// 알림 단건 읽음 처리
notificationRouter.patch(
  "/:notificationId/read",
  authenticate,
  authorize("OWNER", "SITTER"),
  markNotificationAsReadController,
);
