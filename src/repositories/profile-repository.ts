import { prisma } from "../config/prisma.js";
import type { UpdateOwnerProfileInput } from "../types/profile.js";

const OWNER_PROFILE_SELECT = {
  id: true,
  userId: true,
  profileImageUrl: true,
  preferredServiceTypes: true,
  livingRegion: true,
} as const;

// 팟오너 프로필 조회 (User 1 : OwnerProfile 1, userId UNIQUE)
export const findOwnerProfileByUserId = (userId: bigint) => {
  return prisma.ownerProfile.findUnique({
    where: { userId },
    select: OWNER_PROFILE_SELECT,
  });
};

// 팟오너 프로필 수정
export const updateOwnerProfileByUserId = (userId: bigint, data: UpdateOwnerProfileInput) => {
  return prisma.ownerProfile.update({
    where: { userId },
    data,
    select: OWNER_PROFILE_SELECT,
  });
};

const SITTER_PROFILE_SELECT = {
  id: true,
  userId: true,
  profileImageUrl: true,
  gender: true,
  shortIntroduction: true,
  description: true,
  sitterServices: { select: { serviceType: true }, orderBy: { id: "asc" } },
  sitterServiceRegions: { select: { region: true }, orderBy: { id: "asc" } },
} as const;

// 팟트너 프로필 조회 (서비스 유형·지역 포함)
export const findSitterProfileByUserId = (userId: bigint) => {
  return prisma.sitterProfile.findUnique({
    where: { userId },
    select: SITTER_PROFILE_SELECT,
  });
};
