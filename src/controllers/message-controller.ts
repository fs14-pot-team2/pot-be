import type { NextFunction, Request, Response } from "express";
import AppError from "../errors/app-error.js";
import * as messageService from "../services/message-service.js";
import {
  validateConversationIdParam,
  validateCursorQuery,
  validateOtherUserIdParam,
  validateSendMessageBody,
} from "../validators/message-validator.js";

export async function getConversationsController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");

    const { cursor, limit } = validateCursorQuery({
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    const result = await messageService.getConversations(req.user.id, cursor, limit);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getMessagesController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");

    const otherUserId = validateOtherUserIdParam(req.params.otherUserId);
    const { cursor, limit } = validateCursorQuery({
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    const result = await messageService.getMessages(
      req.user.id,
      req.user.role,
      otherUserId,
      cursor,
      limit,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function sendMessageController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");

    const input = validateSendMessageBody(req.body);
    const result = await messageService.sendMessage(req.user.id, req.user.role, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function readMessagesController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");

    const conversationId = validateConversationIdParam(req.params.conversationId);
    await messageService.readConversationMessages(req.user.id, conversationId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function getUnreadStatusController(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHORIZED");

    const result = await messageService.getUnreadStatus(req.user.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
