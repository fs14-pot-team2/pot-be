import { prisma } from "../config/prisma.js";
import { runScheduledTasks } from "../services/scheduled-tasks-service.js";
import type { ScheduledTasksOutput } from "../types/scheduled-tasks.js";

// 예약 작업 실행 Lambda 진입점
export async function scheduledTasksHandler(): Promise<ScheduledTasksOutput> {
  try {
    return await runScheduledTasks();
  } finally {
    await prisma.$disconnect();
  }
}
