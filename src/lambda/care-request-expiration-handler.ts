import { prisma } from "../config/prisma.js";
import { findReviewAvailableNotificationsForRedelivery } from "../repositories/notification-repository.js";
import { expirePastCareRequests } from "../services/care-request-expiration.js";
import { deliverReviewAvailableNotificationWithRetry } from "../services/review-available-notification-delivery-service.js";
import { createReviewAvailableNotifications } from "../services/review-available-notification-service.js";
import { getTodayInKst } from "../utils/kst-date.js";

// 돌봄 요청 정기 만료 처리 Lambda 진입점
export async function expirePastCareRequestsHandler() {
  try {
    const expiredCareRequestCount = await expirePastCareRequests();

    const today = new Date(`${getTodayInKst()}T00:00:00.000Z`);

    // 신규 알림 생성 이전에 기존 알림 재전송 대상 확보
    const existingNotifications = await findReviewAvailableNotificationsForRedelivery(today);

    const { reviewAvailableNotificationCount, notifications } =
      await createReviewAvailableNotifications();

    // 기존 알림은 최초 전송부터 리뷰 작성 여부 재확인
    for (const notification of existingNotifications) {
      await deliverReviewAvailableNotificationWithRetry(notification, true);
    }

    // 신규 알림은 생성 과정의 검증 결과를 재사용
    for (const notification of notifications) {
      await deliverReviewAvailableNotificationWithRetry(notification, false);
    }

    return {
      expiredCareRequestCount,
      reviewAvailableNotificationCount,
      notifications,
    };
  } finally {
    await prisma.$disconnect();
  }
}
