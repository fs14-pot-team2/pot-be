import { prisma } from "../config/prisma.js";
import { CareRequestStatus, NotificationType } from "../generated/prisma/enums.js";
import {
  findCareRequest,
  findCareRequestsEligibleForExpiringNotification,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import { insertNotifications } from "../repositories/notification-repository.js";
import type { TransactionRunner } from "../types/db.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { createNotificationMessage } from "../utils/notification-message.js";

// 실제 만료일(startDate 다음 날)의 하루 전인 활성 요청에 알림 생성
export async function createCareRequestExpiringNotifications(
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const scheduledDate = getTodayInKst();
  const today = new Date(`${scheduledDate}T00:00:00.000Z`);
  const careRequests = await findCareRequestsEligibleForExpiringNotification(today);

  const notifications: {
    id: bigint;
    recipientId: bigint;
    careRequestId: bigint;
    scheduledDate: string;
  }[] = [];

  for (const candidate of careRequests) {
    const createdNotifications = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(candidate.id, tx);

      const careRequest = await findCareRequest(candidate.id, tx);

      if (
        !careRequest ||
        careRequest.status !== CareRequestStatus.OPEN ||
        getTodayInKst() !== scheduledDate ||
        careRequest.startDate.getTime() !== today.getTime()
      ) {
        return [];
      }

      return insertNotifications(
        [
          {
            recipientId: careRequest.ownerId,
            careRequestId: careRequest.id,
            type: NotificationType.CARE_REQUEST_EXPIRING,
            message: createNotificationMessage({
              type: NotificationType.CARE_REQUEST_EXPIRING,
            }),
          },
        ],
        tx,
        { skipDuplicates: true },
      );
    });

    notifications.push(
      ...createdNotifications.map((notification) => ({
        ...notification,
        careRequestId: candidate.id,
        scheduledDate,
      })),
    );
  }

  return {
    careRequestExpiringNotificationCount: notifications.length,
    notifications,
  };
}
