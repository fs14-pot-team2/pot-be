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
