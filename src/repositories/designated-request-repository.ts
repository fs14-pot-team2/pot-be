import { prisma } from "../config/prisma.js";
import { UserRole } from "../generated/prisma/enums.js";
import type { DbClient } from "../types/db.js";

// 지정 요청을 받을 팟트너의 존재 및 역할 확인
export function findSitterByIdAndRole(sitterId: bigint, db: DbClient = prisma) {
  return db.user.findFirst({
    where: {
      id: sitterId,
      role: UserRole.SITTER,
    },
    select: { id: true },
  });
}

// 동일 팟트너에게 이미 지정 요청을 보냈는지 확인
export function findDesignatedRequestByCareRequestAndSitter(
  careRequestId: bigint,
  sitterId: bigint,
  db: DbClient = prisma,
) {
  return db.designatedRequest.findUnique({
    where: {
      careRequestId_sitterId: {
        careRequestId,
        sitterId,
      },
    },
    select: { id: true },
  });
}

// 지정 대상 팟트너가 이미 견적을 제출했는지 확인
export function findQuoteByCareRequestAndSitter(
  careRequestId: bigint,
  sitterId: bigint,
  db: DbClient = prisma,
) {
  return db.quote.findUnique({
    where: {
      careRequestId_sitterId: {
        careRequestId,
        sitterId,
      },
    },
    select: { id: true },
  });
}

// 반려된 요청을 포함한 누적 지정 요청 건수 조회
export function countDesignatedRequestsByCareRequest(careRequestId: bigint, db: DbClient = prisma) {
  return db.designatedRequest.count({
    where: { careRequestId },
  });
}

// 기존 돌봄 요청과 팟트너를 연결하는 지정 요청 생성
export function insertDesignatedRequest(
  careRequestId: bigint,
  sitterId: bigint,
  db: DbClient = prisma,
) {
  return db.designatedRequest.create({
    data: {
      careRequestId,
      sitterId,
    },
  });
}
