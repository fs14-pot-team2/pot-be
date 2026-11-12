import AppError from "../errors/app-error.js";
import {
  findAnyUnreadNotification,
  findNotification,
  findNotificationForRead,
  findNotifications,
  updateNotificationReadAt,
  updateNotificationsReadAt,
} from "../repositories/notification-repository.js";
import { isRecordNotFoundError } from "../utils/prisma-error.js";

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

// 본인 미확인 알림 존재 여부 조회
export async function hasUnreadNotification(recipientId: bigint) {
  const unreadNotification = await findAnyUnreadNotification(recipientId);

  return {
    hasUnreadNotification: unreadNotification !== null,
  };
}

// 알림 단건 읽음 처리
export async function markNotificationAsRead(recipientId: bigint, notificationId: bigint) {
  const notification = await findNotificationForRead(notificationId);

  if (!notification) {
    throw new AppError("NOTIFICATION_NOT_FOUND");
  }

  if (notification.recipientId !== recipientId) {
    throw new AppError("FORBIDDEN");
  }

  let notificationReadAt = notification.readAt;

  if (notificationReadAt === null) {
    try {
      const updatedNotification = await updateNotificationReadAt(
        notificationId,
        recipientId,
        new Date(),
      );

      notificationReadAt = updatedNotification.readAt;
    } catch (error) {
      if (!isRecordNotFoundError(error)) {
        throw error;
      }

      const refreshedNotification = await findNotificationForRead(notificationId);

      if (!refreshedNotification) {
        throw new AppError("NOTIFICATION_NOT_FOUND");
      }

      if (refreshedNotification.recipientId !== recipientId) {
        throw new AppError("FORBIDDEN");
      }

      if (refreshedNotification.readAt === null) {
        throw error;
      }

      notificationReadAt = refreshedNotification.readAt;
    }
  }

  return { id: notification.id, readAt: notificationReadAt };
}

// 본인 미확인 알림 일괄 읽음 처리
export async function markAllNotificationsAsRead(recipientId: bigint) {
  const updatedNotificationsCount = (await updateNotificationsReadAt(recipientId, new Date()))
    .count;

  return { updatedCount: updatedNotificationsCount };
}
