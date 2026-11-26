import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { CareRequestStatus, NotificationType } from "../generated/prisma/enums.js";
import {
  findCareRequestForCareScheduleNotification,
  findCareRequestsEligibleForCareScheduleNotification,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import { insertNotifications } from "../repositories/notification-repository.js";
import type { TransactionRunner } from "../types/db.js";
import { getTodayInKst, isBeforeTodayInKst } from "../utils/kst-date.js";
import { createNotificationMessage } from "../utils/notification-message.js";

// KST 기준 돌봄 시작일 및 종료일 하루 전 알림 생성
export async function createCareScheduleNotifications(
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const scheduledDate = getTodayInKst();
  const today = new Date(`${scheduledDate}T00:00:00.000Z`);

  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const schedules = [
    {
      dateField: "startDate",
      date: today,
      ownerType: NotificationType.OWNER_CARE_STARTED,
      sitterType: NotificationType.SITTER_CARE_STARTED,
      event: "STARTED",
    },
    {
      dateField: "endDate",
      date: tomorrow,
      ownerType: NotificationType.OWNER_CARE_ENDING,
      sitterType: NotificationType.SITTER_CARE_ENDING,
      event: "ENDING",
    },
  ] as const;

  const notifications: {
    id: bigint;
    recipientId: bigint;
    careRequestId: bigint;
    event: "STARTED" | "ENDING";
    scheduledDate: string;
  }[] = [];

  for (const schedule of schedules) {
    const careRequests = await findCareRequestsEligibleForCareScheduleNotification(
      schedule.date,
      schedule.dateField,
      schedule.event === "ENDING" ? today : null,
    );

    for (const candidate of careRequests) {
      const createdNotifications = await runTransaction(async (tx) => {
        await lockCareRequestForUpdate(candidate.id, tx);

        const careRequest = await findCareRequestForCareScheduleNotification(candidate.id, tx);

        if (
          !careRequest ||
          careRequest.status !== CareRequestStatus.MATCHED ||
          careRequest.confirmedQuoteId === null ||
          getTodayInKst() !== scheduledDate ||
          careRequest[schedule.dateField].getTime() !== schedule.date.getTime() ||
          (schedule.event === "ENDING" && !isBeforeTodayInKst(careRequest.startDate))
        ) {
          return [];
        }

        const confirmedQuote = careRequest.confirmedQuote;

        if (!confirmedQuote) {
          throw new AppError("INTERNAL_SERVER_ERROR");
        }

        return insertNotifications(
          [
            {
              recipientId: careRequest.ownerId,
              careRequestId: careRequest.id,
              type: schedule.ownerType,
              message: createNotificationMessage({
                type: schedule.ownerType,
                nickname: confirmedQuote.sitter.nickname,
              }),
            },
            {
              recipientId: confirmedQuote.sitterId,
              careRequestId: careRequest.id,
              type: schedule.sitterType,
              message: createNotificationMessage({
                type: schedule.sitterType,
                nickname: careRequest.owner.nickname,
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
          event: schedule.event,
          scheduledDate,
        })),
      );
    }
  }

  return {
    careScheduleNotificationCount: notifications.length,
    notifications,
  };
}
