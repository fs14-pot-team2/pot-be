import { prisma } from "../config/prisma.js";
import { expirePastCareRequests } from "../services/care-request-expiration.js";
import { deliverCareScheduleNotificationWithRetry } from "../services/care-schedule-notification-delivery-service.js";
import { createCareScheduleNotifications } from "../services/care-schedule-notification-service.js";
import { deliverReviewAvailableNotificationWithRetry } from "../services/review-available-notification-delivery-service.js";
import { createReviewAvailableNotifications } from "../services/review-available-notification-service.js";
import { serializeBigInt } from "../utils/bigint.js";

// 돌봄 요청 정기 만료 처리 Lambda 진입점
export async function expirePastCareRequestsHandler() {
  try {
    // 시작일이 지난 OPEN 돌봄 요청 정기 만료 처리
    const expiredCareRequestCount = await expirePastCareRequests();

    const { reviewAvailableNotificationCount, notifications } =
      await createReviewAvailableNotifications();

    // 리뷰 작성 가능 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
    for (const notification of notifications) {
      await deliverReviewAvailableNotificationWithRetry(notification);
    }

    const { careScheduleNotificationCount, notifications: careScheduleNotifications } =
      await createCareScheduleNotifications();

    // 돌봄 시작·종료 임박 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
    for (const notification of careScheduleNotifications) {
      await deliverCareScheduleNotificationWithRetry(notification);
    }

    return {
      expiredCareRequestCount,
      reviewAvailableNotificationCount,
      careScheduleNotificationCount,
      notifications: serializeBigInt([...notifications, ...careScheduleNotifications]),
    };
  } finally {
    await prisma.$disconnect();
  }
}
