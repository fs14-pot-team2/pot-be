import { CareRequestStatus } from "../generated/prisma/enums.js";
import { findCareRequest } from "../repositories/care-request-repository.js";
import { getTodayInKst, isBeforeTodayInKst } from "../utils/kst-date.js";
import { sendInternalSseNotification } from "./internal-sse-http-service.js";

const MAX_SEND_COUNT = 3;
const RETRY_WAIT_BASE_MS = 300;

interface NotificationForDelivery {
  id: bigint;
  recipientId: bigint;
}

interface CareRequestExpiringNotification extends NotificationForDelivery {
  careRequestId: bigint;
  scheduledDate: string;
}

interface CareScheduleNotification extends NotificationForDelivery {
  careRequestId: bigint;
  event: "STARTED" | "ENDING";
  scheduledDate: string;
}

interface CareRequestExpiredNotification extends NotificationForDelivery {
  careRequestId: bigint;
}

// 알림별 유효성 검증을 유지하면서 SSE 전송·재시도 공통 처리
async function deliverNotificationWithRetry(
  notification: NotificationForDelivery,
  canSend: (sendCount: number) => Promise<boolean>,
  failureMessage: string,
  failureContext?: Pick<CareScheduleNotification, "event">,
): Promise<void> {
  for (let sendCount = 1; sendCount <= MAX_SEND_COUNT; sendCount++) {
    if (!(await canSend(sendCount))) {
      return;
    }

    try {
      const statusCode = await sendInternalSseNotification(
        notification.id,
        notification.recipientId,
      );

      if (statusCode === 204) {
        return;
      }

      // 최종 전송 실패는 로그만 기록하고 기존 DB 알림은 유지
      // 정책에 따라 실패 이력을 별도로 저장하거나 Lambda 종료 후 자동 재전송하지 않음
      if (sendCount === MAX_SEND_COUNT) {
        console.error(failureMessage, {
          notificationId: notification.id.toString(),
          ...failureContext,
          statusCode,
          sendCount,
        });
        return;
      }
    } catch (error) {
      if (sendCount === MAX_SEND_COUNT) {
        console.error(failureMessage, {
          notificationId: notification.id.toString(),
          ...failureContext,
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

// 활성 돌봄 요청 만료 임박 신규 알림 SSE 전송 실패 시 제한 횟수 재시도
export async function deliverCareRequestExpiringNotificationWithRetry(
  notification: CareRequestExpiringNotification,
): Promise<void> {
  return deliverNotificationWithRetry(
    notification,
    async (sendCount) => {
      // 최초 전송을 포함해 발생 예정일이 아니면 SSE 전송 중단
      if (getTodayInKst() !== notification.scheduledDate) {
        return false;
      }

      // 최초 전송은 생성 시 검증 결과를 사용하고 재시도 시 상태·시작일 재확인
      if (sendCount > 1) {
        const careRequest = await findCareRequest(notification.careRequestId);

        if (
          !careRequest ||
          careRequest.status !== CareRequestStatus.OPEN ||
          careRequest.startDate.toISOString().slice(0, 10) !== notification.scheduledDate
        ) {
          return false;
        }
      }

      return true;
    },
    "돌봄 요청 만료 임박 알림 SSE 전송 최종 실패",
  );
}

// 매칭된 돌봄 일정 신규 알림 SSE 전송 실패 시 제한 횟수 재시도
export async function deliverCareScheduleNotificationWithRetry(
  notification: CareScheduleNotification,
): Promise<void> {
  return deliverNotificationWithRetry(
    notification,
    async (sendCount) => {
      // 최초 전송을 포함해 발생 예정일이 아니면 SSE 전송 중단
      if (getTodayInKst() !== notification.scheduledDate) {
        return false;
      }

      const expectedDate = new Date(`${notification.scheduledDate}T00:00:00.000Z`);

      if (notification.event === "ENDING") {
        expectedDate.setUTCDate(expectedDate.getUTCDate() + 1);
      }

      // 최초 전송은 생성 시 검증 결과를 사용하고 재시도 시 요청 상태·일정 재확인
      if (sendCount > 1) {
        const careRequest = await findCareRequest(notification.careRequestId);

        if (
          !careRequest ||
          careRequest.status !== CareRequestStatus.MATCHED ||
          careRequest.confirmedQuoteId === null
        ) {
          return false;
        }

        const careDate =
          notification.event === "STARTED" ? careRequest.startDate : careRequest.endDate;

        if (
          careDate.getTime() !== expectedDate.getTime() ||
          (notification.event === "ENDING" && !isBeforeTodayInKst(careRequest.startDate))
        ) {
          return false;
        }
      }

      return true;
    },
    "돌봄 일정 알림 SSE 전송 최종 실패",
    { event: notification.event },
  );
}

// 견적을 보낸 돌봄 요청 만료 신규 알림 SSE 전송 실패 시 제한 횟수 재시도
export async function deliverCareRequestExpiredNotificationWithRetry(
  notification: CareRequestExpiredNotification,
): Promise<void> {
  return deliverNotificationWithRetry(
    notification,
    async (sendCount) => {
      // 최초 전송은 생성 시 검증 결과를 사용하고 재시도 시 만료 상태 재확인
      if (sendCount > 1) {
        const careRequest = await findCareRequest(notification.careRequestId);

        if (!careRequest || careRequest.status !== CareRequestStatus.EXPIRED) {
          return false;
        }
      }

      return true;
    },
    "돌봄 요청 만료 알림 SSE 전송 최종 실패",
  );
}
