import { findReviewByCareRequestId } from "../repositories/review-repository.js";
import { sendInternalSseNotification } from "./internal-sse-http-service.js";

const MAX_SEND_COUNT = 3;
const RETRY_WAIT_BASE_MS = 300;

interface ReviewAvailableNotification {
  id: bigint;
  recipientId: bigint;
  careRequestId: bigint;
}

// 리뷰 작성 상태를 확인 & 알림 SSE 전송 실패 시 제한 횟수 재시도
export async function deliverReviewAvailableNotificationWithRetry(
  notification: ReviewAvailableNotification,
  isExistingNotification: boolean,
): Promise<void> {
  for (let sendCount = 1; sendCount <= MAX_SEND_COUNT; sendCount++) {
    // 기존 알림은 최초 전송부터, 신규 알림은 재시도부터 리뷰 존재 여부 확인
    if (isExistingNotification || sendCount > 1) {
      const review = await findReviewByCareRequestId(notification.careRequestId);

      if (review) {
        return;
      }
    }

    try {
      const statusCode = await sendInternalSseNotification(
        notification.id,
        notification.recipientId,
      );

      if (statusCode === 204) {
        return;
      }

      // 최종 전송 실패는 로그만 기록하고, 이미 저장된 DB 알림은 유지
      // 정책에 따라 실패 이력을 별도로 저장하거나 Lambda 종료 후 자동 재전송하지 않음
      if (sendCount === MAX_SEND_COUNT) {
        console.error("리뷰 작성 가능 알림 SSE 전송 최종 실패", {
          notificationId: notification.id.toString(),
          statusCode,
          sendCount,
        });
        return;
      }
    } catch (error) {
      if (sendCount === MAX_SEND_COUNT) {
        console.error("리뷰 작성 가능 알림 SSE 전송 최종 실패", {
          notificationId: notification.id.toString(),
          sendCount,
          error,
        });
        return;
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, RETRY_WAIT_BASE_MS * sendCount);
    });
  }
}
