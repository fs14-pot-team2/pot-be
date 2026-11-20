import { prisma } from "../config/prisma.js";
import { runScheduledTasks } from "../services/scheduled-tasks-service.js";
import type { ScheduledTasksOutput } from "../types/scheduled-tasks.js";

// 예약 작업 실행 Lambda 진입점
export async function scheduledTasksHandler(): Promise<ScheduledTasksOutput> {
  try {
    const scheduledTasksOutput = await runScheduledTasks();

    // 정책에 따라 실패 건수는 별도로 집계하지 않고, 정상 처리된 건수만 CloudWatch 로그에 기록
    console.info(
      JSON.stringify({
        event: "scheduled_tasks_completed",
        timestamp: new Date().toISOString(),
        expiredCareRequestCount: scheduledTasksOutput.expiredCareRequestCount,
        careRequestExpiredNotificationCount:
          scheduledTasksOutput.careRequestExpiredNotificationCount,
        reviewAvailableNotificationCount: scheduledTasksOutput.reviewAvailableNotificationCount,
        careScheduleNotificationCount: scheduledTasksOutput.careScheduleNotificationCount,
        careRequestExpiringNotificationCount:
          scheduledTasksOutput.careRequestExpiringNotificationCount,
      }),
    );

    return scheduledTasksOutput;
  } finally {
    await prisma.$disconnect();
  }
}
