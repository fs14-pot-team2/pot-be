import type { Response } from "express";

// 이벤트 이름별 페이로드. 이벤트에는 식별자만 담고, 실제 데이터는 프론트가 기존 조회 API로 다시 가져온다.
export interface SseEventPayloads {
  "notification.created": { notificationId: string };
  "message.created": { conversationId: string; messageId: string; senderId: string };
}

export type SseEventName = keyof SseEventPayloads;

// 사용자 ID -> 연결된 응답 목록 (탭마다 연결이 생기므로 Set으로 관리)
// 메모리 기반이라 Elastic Beanstalk 인스턴스가 1대일 때만 모든 이벤트가 전달된다.
const clients = new Map<string, Set<Response>>();

export function addSseClient(userId: bigint, response: Response): void {
  const key = userId.toString();
  const connections = clients.get(key) ?? new Set<Response>();
  connections.add(response);
  clients.set(key, connections);
}

export function removeSseClient(userId: bigint, response: Response): void {
  const key = userId.toString();
  const connections = clients.get(key);
  if (!connections) return;

  connections.delete(response);
  if (connections.size === 0) {
    clients.delete(key);
  }
}

// 알림·쪽지 서비스에서 DB 저장이 끝난 뒤 호출한다.
// 연결이 없거나 전송에 실패해도 호출한 API의 응답에는 영향을 주지 않는다.
export function publishToUser<E extends SseEventName>(
  userId: bigint,
  event: E,
  data: SseEventPayloads[E],
): void {
  const key = userId.toString();
  const connections = clients.get(key);
  if (!connections) return;

  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const response of connections) {
    if (response.writableEnded || response.destroyed) {
      connections.delete(response);
      continue;
    }
    try {
      response.write(frame);
    } catch (error) {
      console.error("SSE 이벤트 전송에 실패했습니다.", error);
    }
  }

  // 닫힌 연결을 정리한 뒤 비어 있으면 사용자 키도 제거
  if (connections.size === 0) {
    clients.delete(key);
  }
}

export function getSseConnectionCount(): number {
  let count = 0;
  for (const connections of clients.values()) {
    count += connections.size;
  }
  return count;
}
