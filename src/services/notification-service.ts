import AppError from "../errors/app-error.js";
import { findCareRequest } from "../repositories/care-request-repository.js";
import {
  findDesignatedRequest,
  findRejectedRequestByDesignatedRequestId,
} from "../repositories/designated-request-repository.js";
import { findQuoteByCareRequestAndSitter } from "../repositories/quote-repository.js";
import {
  findCareRequestForReview,
  findReviewByCareRequestId,
} from "../repositories/review-repository.js";
import {
  findAnyUnreadNotification,
  findNotification,
  findNotificationForRead,
  findNotifications,
  updateNotificationReadAt,
  updateNotificationsReadAt,
} from "../repositories/notification-repository.js";
import { isRecordNotFoundError } from "../utils/prisma-error.js";
import { isBeforeTodayInKst } from "../utils/kst-date.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";

type ReviewStatus = "AVAILABLE" | "WRITTEN" | "DELETED" | "UNAVAILABLE";

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

// 알림에 연결된 돌봄 요청의 최신 상태 조회
async function getRelatedCareRequestStatus(careRequestId: bigint) {
  const careRequest = await findCareRequest(careRequestId);

  if (!careRequest) {
    throw new AppError("INTERNAL_SERVER_ERROR");
  }

  try {
    const wasExpired = await expireCareRequestIfPast(careRequest);

    if (wasExpired) {
      return "EXPIRED";
    }

    return careRequest.status;
  } catch (error) {
    if (!isRecordNotFoundError(error)) {
      throw error;
    }

    // 만료 처리 충돌 시 최신 돌봄 요청 상태 재확인
    const refreshedRequest = await findCareRequest(careRequestId);

    if (!refreshedRequest || refreshedRequest.status === "OPEN") {
      throw error;
    }

    return refreshedRequest.status;
  }
}

// 지정 요청 알림에 연결된 견적 제출 및 반려 이력 조회
async function getRelatedDesignatedRequestStatus(
  careRequestId: bigint,
  recipientId: bigint,
  designatedRequestId: bigint | null,
) {
  if (designatedRequestId === null) {
    throw new AppError("INTERNAL_SERVER_ERROR");
  }

  const designatedRequest = await findDesignatedRequest(designatedRequestId);

  if (
    !designatedRequest ||
    designatedRequest.careRequestId !== careRequestId ||
    designatedRequest.sitterId !== recipientId
  ) {
    throw new AppError("INTERNAL_SERVER_ERROR");
  }

  const [quote, rejectedRequest] = await Promise.all([
    findQuoteByCareRequestAndSitter(careRequestId, recipientId),
    findRejectedRequestByDesignatedRequestId(designatedRequestId),
  ]);

  return {
    quoteId: quote?.id ?? null,
    rejectedRequestId: rejectedRequest?.id ?? null,
  };
}

// 리뷰 관련 알림에 연결된 최신 리뷰 상태 조회
async function getRelatedReviewStatus(careRequestId: bigint): Promise<ReviewStatus> {
  const review = await findReviewByCareRequestId(careRequestId);

  if (review) {
    if (review.deletedAt !== null) {
      return "DELETED";
    }

    return "WRITTEN";
  }

  const careRequest = await findCareRequestForReview(careRequestId);

  if (!careRequest) {
    throw new AppError("INTERNAL_SERVER_ERROR");
  }

  // 기존 리뷰 작성 가능 조건 적용
  if (
    careRequest.status !== "MATCHED" ||
    !careRequest.confirmedQuote ||
    !isBeforeTodayInKst(careRequest.endDate)
  ) {
    return "UNAVAILABLE";
  }

  return "AVAILABLE";
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

  const careRequestStatus = await getRelatedCareRequestStatus(notification.careRequestId);

  let quoteId: bigint | null = null;
  let rejectedRequestId: bigint | null = null;
  let reviewStatus: ReviewStatus | null = null;

  // 팟트너의 지정 요청 수신 알림: 견적 제출 및 반려 여부 확인
  if (notification.type === "DESIGNATED_REQUEST_RECEIVED") {
    const designatedRequestStatus = await getRelatedDesignatedRequestStatus(
      notification.careRequestId,
      recipientId,
      notification.designatedRequestId,
    );

    quoteId = designatedRequestStatus.quoteId;
    rejectedRequestId = designatedRequestStatus.rejectedRequestId;
  }

  // 팟오너/팟트너의 리뷰 관련 알림: 리뷰 작성·삭제 이력 및 작성 가능 여부 확인
  if (notification.type === "REVIEW_AVAILABLE" || notification.type === "REVIEW_RECEIVED") {
    reviewStatus = await getRelatedReviewStatus(notification.careRequestId);
  }

  return {
    id: notification.id,
    readAt: notificationReadAt,
    relatedStatus: {
      careRequestStatus,
      quoteId,
      rejectedRequestId,
      reviewStatus,
    },
  };
}

// 본인 미확인 알림 일괄 읽음 처리
export async function markAllNotificationsAsRead(recipientId: bigint) {
  const updatedNotificationsCount = (await updateNotificationsReadAt(recipientId, new Date()))
    .count;

  return { updatedCount: updatedNotificationsCount };
}
