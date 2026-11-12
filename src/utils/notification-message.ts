import type { NotificationType } from "../generated/prisma/enums.js";

// 알림 유형별 메시지 템플릿
const notificationMessages = {
  // 팟오너
  QUOTE_RECEIVED: "{nickname} 팟트너의 돌봄 견적이 도착했어요!",
  QUOTE_UPDATED: "{nickname} 팟트너가 견적을 수정했어요.",
  DESIGNATED_REQUEST_REJECTED: "{nickname} 팟트너가 요청을 반려했어요.",
  OWNER_CARE_STARTED: "{nickname} 팟트너의 돌봄이 시작되는 날이에요!",
  OWNER_CARE_ENDING: "{nickname} 팟트너의 돌봄 종료가 하루 남았어요.",
  REVIEW_AVAILABLE: "{nickname} 팟트너에게 리뷰를 작성해 주세요!",
  CARE_REQUEST_EXPIRING: "확정하지 않은 돌봄요청이 내일 만료돼요!",

  // 팟트너
  DESIGNATED_REQUEST_RECEIVED: "{nickname} 팟오너가 지정견적을 요청했어요!",
  QUOTE_CONFIRMED: "{nickname} 팟오너가 내 견적을 확정했어요!",
  REVIEW_RECEIVED: "{nickname} 팟오너가 리뷰를 작성했어요.",
  CARE_REQUEST_CANCELED: "{nickname} 팟오너의 요청이 삭제 되었어요.",
  CARE_REQUEST_EXPIRED: "{nickname} 팟오너의 요청이 만료 되었어요.",
  SITTER_CARE_STARTED: "{nickname} 팟오너의 돌봄이 시작되는 날이에요!",
  SITTER_CARE_ENDING: "{nickname} 팟오너의 돌봄 종료가 하루 남았어요.",
} as const satisfies Record<NotificationType, string>;

type NotificationMessageParams =
  | {
      type: Exclude<NotificationType, "CARE_REQUEST_EXPIRING">;
      nickname: string;
    }
  | {
      type: "CARE_REQUEST_EXPIRING";
    };

// 알림 유형 및 동적 값에 따른 메시지 생성
export function createNotificationMessage(params: NotificationMessageParams): string {
  const messageTemplate = notificationMessages[params.type];

  if ("nickname" in params) {
    return messageTemplate.replace("{nickname}", params.nickname);
  }

  return messageTemplate;
}
