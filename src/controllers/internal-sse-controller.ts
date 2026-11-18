import type { Request, Response } from "express";
import { publishInternalNotification } from "../services/internal-sse-service.js";
import { validateInternalSseNotification } from "../validators/internal-sse-validator.js";

// Lambda 내부 요청 검증 후 SSE 이벤트 전파
export function publishInternalNotificationController(req: Request, res: Response) {
  const { notificationId, recipientId } = validateInternalSseNotification(req.body);

  publishInternalNotification(notificationId, recipientId);

  res.sendStatus(204);
}
