import { prisma } from "../config/prisma.js";

// 팟오너 프로필 조회 (User 1 : OwnerProfile 1, userId UNIQUE)
export const findOwnerProfileByUserId = (userId: bigint) => {
  return prisma.ownerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      profileImageUrl: true,
      preferredServiceTypes: true,
      livingRegion: true,
    },
  });
};
