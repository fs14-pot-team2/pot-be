import { prisma } from "../config/prisma.js";
import type { DbClient } from "../types/db.js";

// 동일 돌봄 요청·팟트너 조합의 기존 숨김 여부 확인
export function findIgnoredRequestByCareRequestAndSitter(
  careRequestId: bigint,
  sitterId: bigint,
  db: DbClient = prisma,
) {
  return db.ignoredRequest.findUnique({
    where: {
      careRequestId_sitterId: {
        careRequestId,
        sitterId,
      },
    },
    select: { id: true },
  });
}

// 공개 돌봄 요청 숨김 처리
export function insertIgnoredRequest(
  careRequestId: bigint,
  sitterId: bigint,
  db: DbClient = prisma,
) {
  return db.ignoredRequest.create({
    data: {
      careRequestId,
      sitterId,
    },
  });
}
