import { prisma } from "../config/prisma.js";
import { expirePastCareRequests } from "../services/care-request-expiration.js";
import { deliverReviewAvailableNotificationWithRetry } from "../services/review-available-notification-delivery-service.js";
import { createReviewAvailableNotifications } from "../services/review-available-notification-service.js";
import { serializeBigInt } from "../utils/bigint.js";

// 돌봄 요청 정기 만료 처리 Lambda 진입점
export async function expirePastCareRequestsHandler() {
  try {
    const expiredCareRequestCount = await expirePastCareRequests();

    const { reviewAvailableNotificationCount, notifications } =
      await createReviewAvailableNotifications();

    // 신규 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 제한 횟수 재시도
    for (const notification of notifications) {
      await deliverReviewAvailableNotificationWithRetry(notification);
    }

    return {
      expiredCareRequestCount,
      reviewAvailableNotificationCount,
      notifications: serializeBigInt(notifications),
    };
  } finally {
    await prisma.$disconnect();
  }
}
