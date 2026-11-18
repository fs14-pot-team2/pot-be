import { prisma } from "../config/prisma.js";
import { expirePastCareRequests } from "../services/care-request-expiration.js";
import { deliverCareRequestExpiringNotificationWithRetry } from "../services/care-request-expiring-notification-delivery-service.js";
import { createCareRequestExpiringNotifications } from "../services/care-request-expiring-notification-service.js";
import { deliverCareScheduleNotificationWithRetry } from "../services/care-schedule-notification-delivery-service.js";
import { createCareScheduleNotifications } from "../services/care-schedule-notification-service.js";
import { deliverReviewAvailableNotificationWithRetry } from "../services/review-available-notification-delivery-service.js";
import { createReviewAvailableNotifications } from "../services/review-available-notification-service.js";
import { serializeBigInt } from "../utils/bigint.js";

// 예약 작업 실행 Lambda 진입점
export async function scheduledTasksHandler() {
  try {
    // 시작일이 지난 OPEN 돌봄 요청 정기 만료 처리
    const expiredCareRequestCount = await expirePastCareRequests();

    const { reviewAvailableNotificationCount, notifications: reviewAvailableNotifications } =
      await createReviewAvailableNotifications();

    // 리뷰 작성 가능 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
    for (const notification of reviewAvailableNotifications) {
      await deliverReviewAvailableNotificationWithRetry(notification);
    }

    const { careScheduleNotificationCount, notifications: careScheduleNotifications } =
      await createCareScheduleNotifications();

    // 돌봄 시작·종료 임박 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
    for (const notification of careScheduleNotifications) {
      await deliverCareScheduleNotificationWithRetry(notification);
    }

    const {
      careRequestExpiringNotificationCount,
      notifications: careRequestExpiringNotifications,
    } = await createCareRequestExpiringNotifications();

    // 활성 돌봄 요청 만료 임박 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
    for (const notification of careRequestExpiringNotifications) {
      await deliverCareRequestExpiringNotificationWithRetry(notification);
    }

    return {
      expiredCareRequestCount,
      reviewAvailableNotificationCount,
      careScheduleNotificationCount,
      careRequestExpiringNotificationCount,
      notifications: serializeBigInt([
        ...reviewAvailableNotifications,
        ...careScheduleNotifications,
        ...careRequestExpiringNotifications,
      ]),
    };
  } finally {
    await prisma.$disconnect();
  }
}
