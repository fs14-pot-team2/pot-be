import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import {
  getNotifications,
  hasUnreadNotification,
  readNotification,
} from "../services/notification-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";
import { validateCursorQuery } from "../validators/pagination-validator.js";

// 본인 알림 목록 조회
export async function getNotificationsController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const { cursor, limit } = validateCursorQuery(
    {
      cursor: req.query.cursor,
      limit: req.query.limit,
    },
    8,
    100,
  );

  const notifications = await getNotifications(req.user.id, { cursor, limit });

  res.status(200).json(serializeBigInt(notifications));
}

// 본인 미확인 알림 존재 여부 조회
export async function hasUnreadNotificationController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  res.status(200).json(await hasUnreadNotification(req.user.id));
}

// 알림 단건 읽음 처리
export async function readNotificationController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const notificationId = parseBigId(req.params.notificationId);

  if (notificationId === null) {
    throw new AppError("INVALID_ID");
  }

  const notification = await readNotification(req.user.id, notificationId);

  res.status(200).json(serializeBigInt(notification));
}
