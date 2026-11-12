import { Router } from "express";
import {
  getConversationsController,
  sendMessageController,
  getMessagesController,
  getUnreadStatusController,
} from "../controllers/message-controller.js";
import { authenticate } from "../middlewares/auth-middleware.js";

export const messageRouter = Router();

// 대화방 목록 조회
messageRouter.get("/conversations", authenticate, getConversationsController);

// 쪽지 발송
messageRouter.post("/messages", authenticate, sendMessageController);

// 쪽지 목록 조회 (대화방이 없으면 빈 목록)
messageRouter.get("/conversations/with/:otherUserId/messages", authenticate, getMessagesController);

// 전체 미확인 쪽지 존재 여부 조회
messageRouter.get("/messages/me/unread", authenticate, getUnreadStatusController);
