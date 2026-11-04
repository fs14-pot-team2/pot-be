import { prisma } from "../config/prisma.js";
import type { SitterListFilter } from "../types/sitter.js";

const SITTER_LIST_SELECT = {
  userId: true,
  profileImageUrl: true,
  gender: true,
  shortIntroduction: true,
  user: { select: { nickname: true } },
  sitterServices: { select: { serviceType: true }, orderBy: { id: "asc" } },
  sitterServiceRegions: { select: { region: true }, orderBy: { id: "asc" } },
} as const;

function buildWhere(filter: SitterListFilter) {
  return {
    ...(filter.keyword && {
      user: { nickname: { contains: filter.keyword, mode: "insensitive" as const } },
    }),
    ...(filter.genders && { gender: { in: filter.genders } }),
    ...(filter.services && {
      sitterServices: { some: { serviceType: { in: filter.services } } },
    }),
    ...(filter.regions && {
      sitterServiceRegions: { some: { region: { in: filter.regions } } },
    }),
  };
}

// 필터에 맞는 팟트너의 userId 전체 (집계·정렬은 service에서)
export const findSitterUserIdsByFilter = async (filter: SitterListFilter) => {
  const rows = await prisma.sitterProfile.findMany({
    where: buildWhere(filter),
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
};

// 한 페이지 분량의 상세 조회 (정렬 순서는 보장되지 않음)
export const findSitterListByUserIds = (userIds: bigint[]) => {
  return prisma.sitterProfile.findMany({
    where: { userId: { in: userIds } },
    select: SITTER_LIST_SELECT,
  });
};
