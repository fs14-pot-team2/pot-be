import { publishToUser } from "./sse-service.js";

// Lambda가 DB에 저장한 알림의 SSE 이벤트 전파
export function publishInternalNotification(notificationId: bigint, recipientId: bigint): void {
  publishToUser(recipientId, "notification.created", {
    notificationId: notificationId.toString(),
  });
}
