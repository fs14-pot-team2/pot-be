import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import {
  findCareRequestForReviewNotification,
  findCareRequestsEligibleForReviewNotification,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import { findReviewByCareRequestId } from "../repositories/review-repository.js";
import { insertNotifications } from "../repositories/notification-repository.js";
import type { TransactionRunner } from "../types/db.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { createNotificationMessage } from "../utils/notification-message.js";

// 리뷰 미작성 상태가 유지되는 돌봄 요청에 리뷰 작성 가능 알림 생성
export async function createReviewAvailableNotifications(
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const today = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  const careRequests = await findCareRequestsEligibleForReviewNotification(today);

  const notifications: { id: bigint; recipientId: bigint }[] = [];

  for (const candidate of careRequests) {
    const createdNotifications = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(candidate.id, tx);

      const careRequest = await findCareRequestForReviewNotification(candidate.id, tx);

      if (
        !careRequest ||
        careRequest.status !== CareRequestStatus.MATCHED ||
        careRequest.confirmedQuoteId === null ||
        careRequest.endDate >= today
      ) {
        return [];
      }

      // 삭제된 리뷰도 존재하는 리뷰로 취급하여 재알림 방지
      const review = await findReviewByCareRequestId(candidate.id, tx);

      if (review) {
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
            type: "REVIEW_AVAILABLE",
            message: createNotificationMessage({
              type: "REVIEW_AVAILABLE",
              nickname: confirmedQuote.sitter.nickname,
            }),
          },
        ],
        tx,
        { skipDuplicates: true },
      );
    });

    notifications.push(...createdNotifications);
  }

  return {
    reviewAvailableNotificationCount: notifications.length,
    notifications,
  };
}
