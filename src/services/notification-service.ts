import AppError from "../errors/app-error.js";
import { findNotification, findNotifications } from "../repositories/notification-repository.js";

// 본인 알림 목록 조회
export async function getNotifications(
  recipientId: bigint,
  query: { cursor: bigint | null; limit: number },
) {
  const { cursor, limit } = query;

  let cursorNotification: { id: bigint; createdAt: Date } | null = null;

  if (cursor !== null) {
    cursorNotification = await findNotification(recipientId, cursor);

    if (!cursorNotification) {
      throw new AppError("INVALID_PAGE_PARAMETER");
    }
  }

  const notifications = await findNotifications(recipientId, limit, cursorNotification);

  const hasNext = notifications.length > limit;
  const paginatedNotifications = notifications.slice(0, limit);

  return {
    items: paginatedNotifications,
    nextCursor: hasNext ? paginatedNotifications[paginatedNotifications.length - 1]!.id : null,
    hasNext,
  };
}
