import { prisma } from "../config/prisma.js";
import { expirePastCareRequests } from "../services/care-request-expiration.js";

// 돌봄 요청 정기 만료 처리 Lambda 진입점
export async function expirePastCareRequestsHandler() {
  try {
    const expiredCareRequestCount = await expirePastCareRequests();

    return { expiredCareRequestCount };
  } finally {
    await prisma.$disconnect();
  }
}
