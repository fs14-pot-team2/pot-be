import { expirePastCareRequests } from "./care-request-expiration.js";
import { createCareRequestExpiringNotifications } from "./care-request-expiring-notification-service.js";
import {
  deliverCareRequestExpiredNotificationWithRetry,
  deliverCareRequestExpiringNotificationWithRetry,
  deliverCareScheduleNotificationWithRetry,
} from "./care-request-notification-delivery-service.js";
import { createCareScheduleNotifications } from "./care-schedule-notification-service.js";
import { deliverReviewAvailableNotificationWithRetry } from "./review-available-notification-delivery-service.js";
import { createReviewAvailableNotifications } from "./review-available-notification-service.js";
import type { ScheduledTasksOutput, ScheduledTasksRunner } from "../types/scheduled-tasks.js";
import { serializeBigInt } from "../utils/bigint.js";

// 실행 환경에 종속되지 않는 공통 예약 작업 실행
export const runScheduledTasks: ScheduledTasksRunner = async (): Promise<ScheduledTasksOutput> => {
  // 시작일이 지난 OPEN 돌봄 요청 정기 만료 처리 및 견적을 보낸 돌봄 요청 만료 알림 생성
  const {
    expiredCareRequestCount,
    careRequestExpiredNotificationCount,
    notifications: careRequestExpiredNotifications,
  } = await expirePastCareRequests();

  // 견적을 보낸 돌봄 요청 만료 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
  for (const notification of careRequestExpiredNotifications) {
    await deliverCareRequestExpiredNotificationWithRetry(notification);
  }

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

  const { careRequestExpiringNotificationCount, notifications: careRequestExpiringNotifications } =
    await createCareRequestExpiringNotifications();

  // 활성 돌봄 요청 만료 임박 알림 생성 후 SSE 전송, 실패 시 동일 실행 내 최대 3회 시도
  for (const notification of careRequestExpiringNotifications) {
    await deliverCareRequestExpiringNotificationWithRetry(notification);
  }

  const notifications = [
    ...careRequestExpiredNotifications,
    ...reviewAvailableNotifications,
    ...careScheduleNotifications,
    ...careRequestExpiringNotifications,
  ];

  return {
    expiredCareRequestCount,
    careRequestExpiredNotificationCount,
    reviewAvailableNotificationCount,
    careScheduleNotificationCount,
    careRequestExpiringNotificationCount,
    notifications: serializeBigInt(notifications) as ScheduledTasksOutput["notifications"],
  };
};
