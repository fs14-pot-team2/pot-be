import { Router } from "express";
import {
  getConversationsController,
  getMessagesController,
  getUnreadStatusController,
  readMessagesController,
  sendMessageController,
} from "../controllers/message-controller.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const messageRouter = Router();

// 대화방 목록 조회
messageRouter.get("/conversations", withAuthentication(getConversationsController));

// 쪽지 발송
messageRouter.post("/messages", withAuthentication(sendMessageController));

// 쪽지 목록 조회 (대화방이 없으면 빈 목록)
messageRouter.get(
  "/conversations/with/:otherUserId/messages",
  withAuthentication(getMessagesController),
);

// 전체 미확인 쪽지 존재 여부 조회
messageRouter.get("/messages/me/unread", withAuthentication(getUnreadStatusController));

// 쪽지 읽음 처리
messageRouter.patch(
  "/conversations/:conversationId/messages/read",
  withAuthentication(readMessagesController),
);
