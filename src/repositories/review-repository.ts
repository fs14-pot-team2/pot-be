import type { DbClient } from "../types/db.js";
import { prisma } from "../config/prisma.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";

// 팟트너 프로필 존재 여부 (상세 조회와 같은 SITTER_NOT_FOUND 기준)
export const existsSitterProfileByUserId = async (userId: bigint) => {
  const profile = await prisma.sitterProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return profile !== null;
};

// 팟트너가 받은 리뷰 목록 (최신순, 같은 시각이면 id 내림차순)
export const findReviewsBySitterId = (sitterId: bigint, skip: number, take: number) => {
  return prisma.review.findMany({
    where: { sitterId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      rating: true,
      content: true,
      createdAt: true,
      owner: { select: { id: true, nickname: true } },
    },
  });
};

// 별점별 리뷰 개수
export const groupRatingDistribution = (sitterId: bigint) => {
  return prisma.review.groupBy({
    by: ["rating"],
    where: { sitterId },
    _count: { _all: true },
  });
};

// 리뷰 작성 가능 여부 판단용 돌봄 요청 조회 (확정된 팟트너 포함)
export function findCareRequestForReview(careRequestId: bigint, db: DbClient = prisma) {
  return db.careRequest.findUnique({
    where: { id: careRequestId },
    select: {
      id: true,
      ownerId: true,
      status: true,
      endDate: true,
      confirmedQuote: { select: { sitterId: true } },
    },
  });
}

// 돌봄 요청당 리뷰 존재 여부
export function findReviewByCareRequestId(careRequestId: bigint, db: DbClient = prisma) {
  return db.review.findUnique({
    where: { careRequestId },
    select: { id: true },
  });
}

// 리뷰 생성
export function insertReview(
  data: {
    careRequestId: bigint;
    ownerId: bigint;
    sitterId: bigint;
    rating: number;
    content: string;
  },
  db: DbClient = prisma,
) {
  return db.review.create({ data });
}

// 작성 가능한 리뷰 조건 (목록과 개수가 같은 조건을 쓰도록 공유)
const writableWhere = (ownerId: bigint, today: Date) => ({
  ownerId,
  status: CareRequestStatus.MATCHED,
  confirmedQuoteId: { not: null },
  endDate: { lt: today },
  review: { is: null },
});

// 작성 가능한 돌봄 요청 목록 (종료일 최신순, 같은 날이면 id 내림차순)
export const findWritableCareRequests = (
  ownerId: bigint,
  today: Date,
  skip: number,
  take: number,
) => {
  return prisma.careRequest.findMany({
    where: writableWhere(ownerId, today),
    orderBy: [{ endDate: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      serviceType: true,
      endDate: true,
      confirmedQuote: {
        select: {
          id: true,
          type: true,
          price: true,
          sitter: {
            select: {
              id: true,
              nickname: true,
              sitterProfile: { select: { profileImageUrl: true } },
            },
          },
        },
      },
    },
  });
};

// 작성 가능한 돌봄 요청 개수
export const countWritableCareRequests = (ownerId: bigint, today: Date) => {
  return prisma.careRequest.count({ where: writableWhere(ownerId, today) });
};

// 팟오너가 작성한 리뷰 목록 (최신순, 같은 시각이면 id 내림차순)
export const findReviewsByOwnerId = (ownerId: bigint, skip: number, take: number) => {
  return prisma.review.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      rating: true,
      content: true,
      createdAt: true,
      careRequest: {
        select: {
          id: true,
          serviceType: true,
          endDate: true,
          confirmedQuote: {
            select: {
              type: true,
              price: true,
              sitter: {
                select: {
                  id: true,
                  nickname: true,
                  sitterProfile: { select: { profileImageUrl: true } },
                },
              },
            },
          },
        },
      },
    },
  });
};

// 팟오너가 작성한 리뷰 개수
export const countReviewsByOwnerId = (ownerId: bigint) => {
  return prisma.review.count({ where: { ownerId } });
};
// 수정·삭제 권한 확인용 리뷰 조회
export function findReviewOwnerById(reviewId: bigint, db: DbClient = prisma) {
  return db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, ownerId: true },
  });
}

// 리뷰 수정 (undefined 필드는 Prisma가 무시)
export function updateReviewById(
  reviewId: bigint,
  data: { rating?: number; content?: string },
  db: DbClient = prisma,
) {
  return db.review.update({ where: { id: reviewId }, data });
}

// 리뷰 삭제 (하드 삭제)
export function deleteReviewById(reviewId: bigint, db: DbClient = prisma) {
  return db.review.delete({ where: { id: reviewId } });
}
