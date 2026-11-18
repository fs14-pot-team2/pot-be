import { findReviewByCareRequestId } from "../repositories/review-repository.js";
import { sendInternalSseNotification } from "./internal-sse-http-service.js";

const MAX_SEND_COUNT = 3;
const RETRY_WAIT_BASE_MS = 300;

interface ReviewAvailableNotification {
  id: bigint;
  recipientId: bigint;
  careRequestId: bigint;
}

// 신규 알림 SSE 전송 실패 시 제한 횟수 재시도
export async function deliverReviewAvailableNotificationWithRetry(
  notification: ReviewAvailableNotification,
): Promise<void> {
  for (let sendCount = 1; sendCount <= MAX_SEND_COUNT; sendCount++) {
    // 최초 전송은 생성 과정의 검증 결과를 사용하고 재시도 시 리뷰 존재 여부 재확인
    if (sendCount > 1) {
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
