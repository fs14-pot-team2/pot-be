// 예약 작업의 실행 환경과 무관한 입출력 계약

interface ScheduledTaskNotificationBase {
  id: string;
  recipientId: string;
  careRequestId: string;
}

interface CareScheduleNotificationResult extends ScheduledTaskNotificationBase {
  event: "STARTED" | "ENDING";
  scheduledDate: string;
}

interface CareRequestExpiringNotificationResult extends ScheduledTaskNotificationBase {
  scheduledDate: string;
}

export type ScheduledTaskNotificationResult =
  | ScheduledTaskNotificationBase
  | CareScheduleNotificationResult
  | CareRequestExpiringNotificationResult;

export interface ScheduledTasksOutput {
  expiredCareRequestCount: number;
  careRequestExpiredNotificationCount: number;
  reviewAvailableNotificationCount: number;
  careScheduleNotificationCount: number;
  careRequestExpiringNotificationCount: number;
  notifications: ScheduledTaskNotificationResult[];
}

export type ScheduledTasksRunner = () => Promise<ScheduledTasksOutput>;
