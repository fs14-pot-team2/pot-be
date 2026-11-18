import AppError from "../errors/app-error.js";
import { parseBigId } from "../utils/bigint.js";

export interface InternalSseNotificationInput {
  notificationId: bigint;
  recipientId: bigint;
}

// Lambda 내부 SSE 전파 요청의 알림 ID 및 수신자 ID 검증
export function validateInternalSseNotification(body: unknown): InternalSseNotificationInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { notificationId, recipientId } = body as Record<string, unknown>;

  const parsedNotificationId = parseBigId(notificationId);
  const parsedRecipientId = parseBigId(recipientId);

  if (parsedNotificationId === null || parsedRecipientId === null) {
    throw new AppError("INVALID_ID");
  }

  return {
    notificationId: parsedNotificationId,
    recipientId: parsedRecipientId,
  };
}
