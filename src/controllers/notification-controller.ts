import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import { getNotifications } from "../services/notification-service.js";
import { serializeBigInt } from "../utils/bigint.js";
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
