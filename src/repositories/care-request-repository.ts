import { prisma } from "../config/prisma.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { CreateCareRequestInput } from "../validators/care-request-validator.js";

export type DbClient = typeof prisma | Prisma.TransactionClient;

// 팟오너의 활성 돌봄 요청 조회
export function findOpenCareRequest(ownerId: bigint, db: DbClient = prisma) {
  return db.careRequest.findFirst({
    where: {
      ownerId,
      status: CareRequestStatus.OPEN,
    },
  });
}

// 돌봄 요청 ID 기준 조회
export function findCareRequestById(careRequestId: bigint, db: DbClient = prisma) {
  return db.careRequest.findUnique({
    where: { id: careRequestId },
  });
}

// 특정 돌봄 요청을 EXPIRED 상태로 변경 (돌봄시작일 만료 정책)
export function expireCareRequest(careRequestId: bigint, db: DbClient = prisma) {
  return db.careRequest.update({
    where: {
      id: careRequestId,
      status: CareRequestStatus.OPEN,
    },
    data: {
      status: CareRequestStatus.EXPIRED,
    },
  });
}

// 신규 돌봄 요청 생성
export function insertCareRequest(
  ownerId: bigint,
  careRequestData: CreateCareRequestInput,
  db: DbClient = prisma,
) {
  return db.careRequest.create({
    data: {
      ownerId,
      serviceType: careRequestData.serviceType,
      startDate: new Date(`${careRequestData.startDate}T00:00:00.000Z`),
      endDate: new Date(`${careRequestData.endDate}T00:00:00.000Z`),
      zonecode: careRequestData.zonecode,
      address: careRequestData.address,
      detailAddress: careRequestData.detailAddress,
      sido: careRequestData.sido,
      sigungu: careRequestData.sigungu,
      bname: careRequestData.bname,
      region: careRequestData.region,
      status: CareRequestStatus.OPEN,
    },
  });
}
