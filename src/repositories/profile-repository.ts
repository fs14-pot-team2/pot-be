import { prisma } from "../config/prisma.js";
import type { DbClient } from "../types/db.js";
import type {
  UpdateOwnerProfileInput,
  CreateSitterProfileInput,
  UpdateSitterProfileInput,
} from "../types/profile.js";

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

// 팟트너 프로필 등록 (서비스 유형·지역 함께 생성)
export const createSitterProfileByUserId = (userId: bigint, input: CreateSitterProfileInput) => {
  return prisma.sitterProfile.create({
    data: {
      userId,
      profileImageUrl: input.profileImageUrl,
      description: input.description,
      gender: input.gender,
      shortIntroduction: input.shortIntroduction,
      sitterServices: {
        create: input.serviceTypes.map((serviceType) => ({ serviceType })),
      },
      sitterServiceRegions: {
        create: input.serviceRegions.map((region) => ({ region })),
      },
    },
    select: SITTER_PROFILE_SELECT,
  });
};

// 팟트너 프로필 조회 (서비스 유형·지역 포함)
export const findSitterProfileByUserId = (userId: bigint) => {
  return prisma.sitterProfile.findUnique({
    where: { userId },
    select: SITTER_PROFILE_SELECT,
  });
};

// 팟트너 프로필 수정: 공개 요청 숨김과 같은 SitterProfile 행 잠금
export const updateSitterProfileByUserId = (userId: bigint, input: UpdateSitterProfileInput) => {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT "id"
      FROM "SitterProfile"
      WHERE "userId" = ${userId}
      FOR UPDATE
    `;

    if (locked.length === 0) {
      return null;
    }

    const sitterProfileId = locked[0].id;

    // undefined 필드는 무시되고, 빈 body여도 update되어 updatedAt이 갱신됨
    await tx.sitterProfile.update({
      where: { id: sitterProfileId },
      data: {
        profileImageUrl: input.profileImageUrl,
        description: input.description,
        gender: input.gender,
        shortIntroduction: input.shortIntroduction,
      },
    });

    if (input.serviceTypes) {
      await tx.sitterService.deleteMany({ where: { sitterProfileId } });
      await tx.sitterService.createMany({
        data: input.serviceTypes.map((serviceType) => ({ sitterProfileId, serviceType })),
      });
    }

    if (input.serviceRegions) {
      await tx.sitterServiceRegion.deleteMany({ where: { sitterProfileId } });
      await tx.sitterServiceRegion.createMany({
        data: input.serviceRegions.map((region) => ({ sitterProfileId, region })),
      });
    }

    return tx.sitterProfile.findUnique({
      where: { id: sitterProfileId },
      select: SITTER_PROFILE_SELECT,
    });
  });
};

const SITTER_MYPAGE_SELECT = {
  userId: true,
  profileImageUrl: true,
  gender: true,
  shortIntroduction: true,
  description: true,
  user: { select: { nickname: true } },
  sitterServices: { select: { serviceType: true }, orderBy: { id: "asc" } },
  sitterServiceRegions: { select: { region: true }, orderBy: { id: "asc" } },
} as const;

// 팟트너 마이페이지 조회 (닉네임 포함)
export const findSitterMyPageByUserId = (userId: bigint) => {
  return prisma.sitterProfile.findUnique({
    where: { userId },
    select: SITTER_MYPAGE_SELECT,
  });
};

// 팟트너 프로필 행 잠금
export async function lockSitterProfileByUserId(userId: bigint, db: DbClient = prisma) {
  const lockedProfiles = await db.$queryRaw<{ id: bigint }[]>`
    SELECT "id"
    FROM "SitterProfile"
    WHERE "userId" = ${userId}
    FOR UPDATE
  `;

  return lockedProfiles[0] ?? null;
}
