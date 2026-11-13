import { prisma } from "../config/prisma.js";
import type { DbClient } from "../types/db.js";

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

// 지정 요청의 존재 및 대상 팟트너 확인
export function findDesignatedRequest(designatedRequestId: bigint, db: DbClient = prisma) {
  return db.designatedRequest.findUnique({
    where: { id: designatedRequestId },
    select: {
      id: true,
      careRequestId: true,
      sitterId: true,
    },
  });
}

// 동일 지정 요청의 기존 반려 여부 확인
export function findRejectedRequestByDesignatedRequestId(
  designatedRequestId: bigint,
  db: DbClient = prisma,
) {
  return db.rejectedRequest.findUnique({
    where: { designatedRequestId },
    select: { id: true },
  });
}

// 팟오너의 반려 사유 조회
export function findRejectedRequest(rejectedRequestId: bigint, db: DbClient = prisma) {
  return db.rejectedRequest.findUnique({
    where: { id: rejectedRequestId },
    select: {
      reason: true,
      designatedRequest: {
        select: {
          careRequest: {
            select: {
              ownerId: true,
              status: true,
            },
          },
        },
      },
    },
  });
}

// 신규 지정 요청 반려 생성
export function insertRejectedRequest(
  designatedRequestId: bigint,
  reason: string,
  db: DbClient = prisma,
) {
  return db.rejectedRequest.create({
    data: {
      designatedRequestId,
      reason,
    },
  });
}

// 팟트너의 반려 요청 목록 조회
export function findRejectedRequestsBySitter(
  sitterId: bigint,
  skip: number,
  take: number,
  db: DbClient = prisma,
) {
  return db.rejectedRequest.findMany({
    where: {
      designatedRequest: { sitterId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      createdAt: true,
      designatedRequest: {
        select: {
          id: true,
          careRequest: {
            select: {
              id: true,
              serviceType: true,
              startDate: true,
              endDate: true,
              sido: true,
              sigungu: true,
              bname: true,
              owner: {
                select: { nickname: true },
              },
            },
          },
        },
      },
    },
  });
}

// 팟트너의 반려 요청 이력 전체 건수 조회
export function countRejectedRequestsBySitter(sitterId: bigint, db: DbClient = prisma) {
  return db.rejectedRequest.count({
    where: {
      designatedRequest: { sitterId },
    },
  });
}
