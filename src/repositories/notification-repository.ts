import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { DbClient } from "../types/db.js";

// 본인 알림의 커서 기준 정보 조회
export function findNotification(
  recipientId: bigint,
  notificationId: bigint,
  db: DbClient = prisma,
) {
  return db.notification.findFirst({
    where: {
      id: notificationId,
      recipientId,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });
}

// 본인 알림 목록 조회
export function findNotifications(
  recipientId: bigint,
  limit: number,
  cursor: { id: bigint; createdAt: Date } | null,
  db: DbClient = prisma,
) {
  const where: Prisma.NotificationWhereInput = {
    recipientId,
    ...(cursor && {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        {
          createdAt: cursor.createdAt,
          id: { lt: cursor.id },
        },
      ],
    }),
  };

  return db.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      type: true,
      message: true,
      readAt: true,
      createdAt: true,
    },
  });
}

// 본인 미확인 알림 존재 여부 조회
export function findAnyUnreadNotification(recipientId: bigint, db: DbClient = prisma) {
  return db.notification.findFirst({
    where: {
      recipientId,
      readAt: null,
    },
    select: {
      id: true,
    },
  });
}

// 알림 단건 읽음 처리를 위한 조회
export function findNotificationForRead(notificationId: bigint, db: DbClient = prisma) {
  return db.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      recipientId: true,
      readAt: true,
    },
  });
}

// 알림 단건 읽음 처리
export function markNotificationAsRead(
  notificationId: bigint,
  recipientId: bigint,
  readAt: Date,
  db: DbClient = prisma,
) {
  return db.notification.update({
    where: {
      id: notificationId,
      recipientId,
      readAt: null,
    },
    data: { readAt },
    select: {
      id: true,
      readAt: true,
    },
  });
}
