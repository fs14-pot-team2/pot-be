// 전달받은 돌봄 요청이 만료 대상인지, 판단하고 만료 대상일 때만 상태를 변경
// 다른 기능의 실행 여부까지 판단하지 않음
import { prisma } from "../config/prisma.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import {
  expireAllPastCareRequests,
  expireCareRequest,
} from "../repositories/care-request-repository.js";
import type { DbClient } from "../types/db.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { serializeDate } from "../utils/serialize-date.js";

interface CareRequestForExpiration {
  id: bigint;
  status: CareRequestStatus;
  startDate: Date;
}

export async function expireCareRequestIfPast(
  careRequest: CareRequestForExpiration,
  db: DbClient = prisma,
): Promise<boolean> {
  if (careRequest.status !== CareRequestStatus.OPEN) {
    return false;
  }

  const startDate = serializeDate(careRequest.startDate);

  if (startDate >= getTodayInKst()) {
    return false;
  }

  await expireCareRequest(careRequest.id, db);

  return true;
}

// 시작일이 지난 모든 활성 돌봄 요청을 기간 만료 상태로 변경
export async function expirePastCareRequests(): Promise<number> {
  const todayInKst = new Date(`${getTodayInKst()}T00:00:00.000Z`);

  const expiredCareRequests = await expireAllPastCareRequests(todayInKst);

  return expiredCareRequests.count;
}
