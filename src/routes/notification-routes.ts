import { Router } from "express";
import {
  getNotificationsController,
  hasUnreadNotificationController,
  markAllNotificationsAsReadController,
  markNotificationAsReadController,
} from "../controllers/notification-controller.js";
import { authorize } from "../middlewares/auth-middleware.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const notificationRouter = Router();

// 팟오너·팟트너
// 알림 목록 조회
notificationRouter.get(
  "/",
  withAuthentication(getNotificationsController, authorize("OWNER", "SITTER")),
);

// 미확인 알림 존재 여부 조회
notificationRouter.get(
  "/unread",
  withAuthentication(hasUnreadNotificationController, authorize("OWNER", "SITTER")),
);

// 알림 단건 읽음 처리
notificationRouter.patch(
  "/:notificationId/read",
  withAuthentication(markNotificationAsReadController, authorize("OWNER", "SITTER")),
);

// 본인 미확인 알림 일괄 읽음 처리
notificationRouter.patch(
  "/read-all",
  withAuthentication(markAllNotificationsAsReadController, authorize("OWNER", "SITTER")),
);
