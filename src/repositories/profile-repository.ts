import { prisma } from "../config/prisma.js";
import type { UpdateOwnerProfileInput } from "../validators/profile-validator.js";

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
