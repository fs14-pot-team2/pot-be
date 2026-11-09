import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { CareRequestStatus, QuoteType } from "../generated/prisma/enums.js";
import type { DbClient } from "../types/db.js";
import type { CreateQuoteInput } from "../validators/quote-validator.js";

// 공개 요청에 대한 견적 건수 조회
export function countGeneralQuotesByCareRequest(careRequestId: bigint, db: DbClient = prisma) {
  return db.quote.count({
    where: {
      careRequestId,
      type: QuoteType.GENERAL,
    },
  });
}

// 신규 견적 생성
export function insertQuote(
  careRequestId: bigint,
  sitterId: bigint,
  type: QuoteType,
  price: number,
  comment: string,
  db: DbClient = prisma,
) {
  return db.quote.create({
    data: {
      careRequestId,
      sitterId,
      type,
      price,
      comment,
    },
  });
}

// 견적 조회
export function findQuote(quoteId: bigint, db: DbClient = prisma) {
  return db.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      careRequestId: true,
      sitterId: true,
    },
  });
}

// 견적 확정을 위한 조회
export function findQuoteForConfirmation(quoteId: bigint, db: DbClient = prisma) {
  return db.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      careRequestId: true,
      sitterId: true,
      type: true,
      price: true,
      comment: true,
    },
  });
}

// 견적 수정
export function updateQuote(
  quoteId: bigint,
  quoteData: Partial<CreateQuoteInput>,
  db: DbClient = prisma,
) {
  return db.quote.update({
    where: { id: quoteId },
    data: quoteData,
  });
}

// 견적 상세 조회 및 접근 권한 검증에 필요한 관계 데이터 조회
export function findQuoteDetail(quoteId: bigint, db: DbClient = prisma) {
  return db.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      sitterId: true,
      price: true,
      comment: true,
      createdAt: true,
      careRequest: {
        select: {
          id: true,
          ownerId: true,
          status: true,
          confirmedQuoteId: true,
          createdAt: true,
          serviceType: true,
          startDate: true,
          endDate: true,
          region: true,
          sido: true,
          sigungu: true,
          bname: true,
          zonecode: true,
          address: true,
          detailAddress: true,
          owner: {
            select: {
              nickname: true,
            },
          },
          designatedRequests: {
            select: {
              id: true,
              sitterId: true,
            },
          },
        },
      },
      sitter: {
        select: {
          id: true,
          nickname: true,
          sitterProfile: {
            select: {
              profileImageUrl: true,
              gender: true,
              shortIntroduction: true,
            },
          },
        },
      },
    },
  });
}

// 팟트너의 기존 견적 존재 여부 확인
export function findQuoteBySitterId(sitterId: bigint, db: DbClient = prisma) {
  return db.quote.findFirst({
    where: { sitterId },
    select: { id: true },
  });
}

// 보낸 견적 목록 조회 필터 설정
function buildSentQuoteFilter(
  sitterId: bigint,
  statuses: CareRequestStatus[],
  confirmedOnly: boolean,
): Prisma.QuoteWhereInput {
  return {
    sitterId,
    careRequest: {
      status: { in: statuses },
    },
    ...(confirmedOnly && {
      confirmedInRequest: { isNot: null },
    }),
  };
}

// 보낸 견적 전체 건수 조회
export function countSentQuotes(
  sitterId: bigint,
  statuses: CareRequestStatus[],
  confirmedOnly: boolean,
  db: DbClient = prisma,
) {
  return db.quote.count({
    where: buildSentQuoteFilter(sitterId, statuses, confirmedOnly),
  });
}

// 보낸 견적 목록 조회
// OPEN 우선 배치는 Service에서 처리하며, 조회 대상 상태 간에는 견적 생성일 최신순 정렬
export function findSentQuotes(
  sitterId: bigint,
  statuses: CareRequestStatus[],
  confirmedOnly: boolean,
  skip: number,
  take: number,
  db: DbClient = prisma,
) {
  return db.quote.findMany({
    where: buildSentQuoteFilter(sitterId, statuses, confirmedOnly),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      price: true,
      comment: true,
      createdAt: true,
      careRequest: {
        select: {
          id: true,
          status: true,
          confirmedQuoteId: true,
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
          },
        },
      },
    },
  });
}
