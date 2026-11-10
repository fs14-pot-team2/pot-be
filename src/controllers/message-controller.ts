import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import {
  getConversations,
  getMessages,
  getUnreadStatus,
  readConversationMessages,
  sendMessage,
} from "../services/message-service.js";
import { serializeBigInt } from "../utils/bigint.js";
import {
  validateConversationIdParam,
  validateCursorQuery,
  validateOtherUserIdParam,
  validateSendMessageBody,
} from "../validators/message-validator.js";

// 대화방 목록 조회
export async function getConversationsController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const { cursor, limit } = validateCursorQuery({
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  const result = await getConversations(req.user.id, cursor, limit);

  res.status(200).json(serializeBigInt(result));
}

// 쪽지 목록 조회
export async function getMessagesController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const otherUserId = validateOtherUserIdParam(req.params.otherUserId);
  const { cursor, limit } = validateCursorQuery({
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  const result = await getMessages(req.user.id, req.user.role, otherUserId, cursor, limit);

  res.status(200).json(serializeBigInt(result));
}

// 쪽지 발송
export async function sendMessageController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const input = validateSendMessageBody(req.body);
  const result = await sendMessage(req.user.id, req.user.role, input);

  res.status(201).json(serializeBigInt(result));
}

// 쪽지 읽음 처리
export async function readMessagesController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const conversationId = validateConversationIdParam(req.params.conversationId);
  await readConversationMessages(req.user.id, conversationId);

  res.status(204).end();
}

// 전체 미확인 쪽지 존재 여부 조회
export async function getUnreadStatusController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const result = await getUnreadStatus(req.user.id);

  res.status(200).json(result);
}
