import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { CareRequestStatus, type Region } from "../generated/prisma/enums.js";
import type { DbClient } from "../types/db.js";
import type {
  CreateCareRequestInput,
  UpdateCareRequestInput,
} from "../validators/care-request-validator.js";

// 팟오너의 활성 돌봄 요청 조회
export function findOpenCareRequest(ownerId: bigint, db: DbClient = prisma) {
  return db.careRequest.findFirst({
    where: {
      ownerId,
      status: CareRequestStatus.OPEN,
    },
  });
}

// 특정 돌봄 요청의 존재 및 상태 확인을 위한 조회
export function findCareRequest(careRequestId: bigint, db: DbClient = prisma) {
  return db.careRequest.findUnique({
    where: { id: careRequestId },
  });
}

// 돌봄 요청 수정 중 견적 생성 방지를 위한 행 잠금
// 견적이 하나라도 있으면 돌봄 요청 수정이 불가하므로, 새 견적 생성을 대기하도록 명시적으로 잠금
export async function lockCareRequestForUpdate(careRequestId: bigint, db: DbClient) {
  await db.$queryRaw`
    SELECT "id"
    FROM "CareRequest"
    WHERE "id" = ${careRequestId}
    FOR UPDATE
  `;
}

// 돌봄 요청의 수정 가능 여부 확인을 위한 견적 조회
export function findQuoteByCareRequestId(careRequestId: bigint, db: DbClient = prisma) {
  return db.quote.findFirst({
    where: { careRequestId },
    select: { id: true },
  });
}

// 시작일이 지난 활성 돌봄 요청을 기간 만료 상태로 변경
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

type CareRequestUpdateData = UpdateCareRequestInput & {
  region?: Region;
};

// 활성 돌봄 요청 수정
export function updateOpenCareRequest(
  careRequestId: bigint,
  ownerId: bigint,
  careRequestData: CareRequestUpdateData,
  db: DbClient = prisma,
) {
  const { startDate, endDate, ...nonDateFields } = careRequestData;

  return db.careRequest.update({
    where: {
      id: careRequestId,
      ownerId,
      status: CareRequestStatus.OPEN,
    },
    data: {
      ...nonDateFields,
      ...(startDate !== undefined && {
        startDate: new Date(`${startDate}T00:00:00.000Z`),
      }),
      ...(endDate !== undefined && {
        endDate: new Date(`${endDate}T00:00:00.000Z`),
      }),
    },
  });
}

// 팟트너 프로필 등록 여부 및 서비스 가능 지역 확인
export function findSitterProfileWithRegions(sitterId: bigint, db: DbClient = prisma) {
  return db.sitterProfile.findUnique({
    where: { userId: sitterId },
    select: {
      sitterServiceRegions: {
        select: { region: true },
      },
    },
  });
}

// 팟트너 프로필 등록 여부 확인
export function findSitterProfileIdByUserId(sitterId: bigint, db: DbClient = prisma) {
  return db.sitterProfile.findUnique({
    where: { userId: sitterId },
    select: { id: true },
  });
}

// 팟트너가 받을 수 있는 돌봄 요청 중 시작일이 지난 요청을 만료 처리
export function expireReceivedCareRequests(
  sitterId: bigint,
  sitterRegions: Region[],
  today: Date,
  db: DbClient = prisma,
) {
  return db.careRequest.updateMany({
    where: {
      status: CareRequestStatus.OPEN,
      startDate: { lt: today },
      OR: [
        { region: { in: sitterRegions } },
        {
          designatedRequests: {
            some: { sitterId },
          },
        },
      ],
    },
    data: {
      status: CareRequestStatus.EXPIRED,
    },
  });
}

// 팟트너가 받은 공개·지정 돌봄 요청 목록 조회
export function findReceivedCareRequests(
  where: Prisma.CareRequestWhereInput,
  orderBy: Prisma.CareRequestOrderByWithRelationInput[],
  skip: number,
  take: number,
  sitterId: bigint,
  db: DbClient = prisma,
) {
  return db.careRequest.findMany({
    where,
    orderBy,
    skip,
    take,
    select: {
      id: true,
      createdAt: true,
      serviceType: true,
      startDate: true,
      endDate: true,
      sido: true,
      sigungu: true,
      bname: true,
      owner: {
        select: {
          nickname: true,
        },
      },
      designatedRequests: {
        where: { sitterId },
        select: { id: true },
        take: 1,
      },
    },
  });
}

// 검색·필터 조건에 따른 받은 돌봄 요청의 전체 건수 조회
export function countReceivedCareRequests(
  where: Prisma.CareRequestWhereInput,
  db: DbClient = prisma,
) {
  return db.careRequest.count({ where });
}

// 팟트너가 받은 지정 요청의 지역 목록 조회
export function findReceivedDesignatedRequestRegions(
  sitterId: bigint,
  today: Date,
  db: DbClient = prisma,
) {
  return db.careRequest.findMany({
    where: {
      status: CareRequestStatus.OPEN,
      startDate: { gte: today },
      designatedRequests: {
        some: { sitterId },
        none: {
          sitterId,
          rejectedRequest: { isNot: null },
        },
      },
      quotes: { none: { sitterId } },
    },
    select: { region: true },
    distinct: ["region"],
  });
}
