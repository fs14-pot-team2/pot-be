// 전달받은 돌봄 요청이 만료 대상인지, 판단하고 만료 대상일 때만 상태를 변경
// 다른 기능의 실행 여부까지 판단하지 않음
import { prisma } from "../config/prisma.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import { expireCareRequest } from "../repositories/care-request-repository.js";
import type { DbClient } from "../types/db.js";
import { getTodayInKst } from "../utils/kst-date.js";

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

  const startDate = careRequest.startDate.toISOString().slice(0, 10);

  if (startDate >= getTodayInKst()) {
    return false;
  }

  await expireCareRequest(careRequest.id, db);

  return true;
}
