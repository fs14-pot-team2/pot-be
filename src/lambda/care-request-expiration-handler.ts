import { prisma } from "../config/prisma.js";
import { expirePastCareRequests } from "../services/care-request-expiration.js";
import { createReviewAvailableNotifications } from "../services/review-available-notification-service.js";

// 돌봄 요청 정기 만료 처리 Lambda 진입점
export async function expirePastCareRequestsHandler() {
  try {
    const expiredCareRequestCount = await expirePastCareRequests();

    const { reviewAvailableNotificationCount, notifications } =
      await createReviewAvailableNotifications();

    return {
      expiredCareRequestCount,
      reviewAvailableNotificationCount,
      notifications,
    };
  } finally {
    await prisma.$disconnect();
  }
}
