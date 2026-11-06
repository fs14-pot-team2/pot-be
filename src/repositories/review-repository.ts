import type { DbClient } from "../types/db.js";
import { prisma } from "../config/prisma.js";

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
