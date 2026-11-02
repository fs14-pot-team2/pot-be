import AppError from "../errors/app-error.js";
import {
  findOwnerProfileByUserId,
  findSitterProfileByUserId,
  updateOwnerProfileByUserId,
} from "../repositories/profile-repository.js";
import type { UpdateOwnerProfileInput } from "../types/profile.js";

type OwnerProfileRecord = NonNullable<Awaited<ReturnType<typeof findOwnerProfileByUserId>>>;

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025"
  );
}

function toOwnerProfileResponse(profile: OwnerProfileRecord) {
  return {
    id: profile.id.toString(),
    userId: profile.userId.toString(),
    profileImageUrl: profile.profileImageUrl ?? null,
    preferredServiceTypes: profile.preferredServiceTypes ?? [],
    livingRegion: profile.livingRegion ?? null,
  };
}

export async function getOwnerProfile(userId: bigint) {
  const profile = await findOwnerProfileByUserId(userId);

  if (!profile) {
    throw new AppError("PROFILE_NOT_FOUND");
  }

  return toOwnerProfileResponse(profile);
}

export async function updateOwnerProfile(userId: bigint, input: UpdateOwnerProfileInput) {
  const existing = await findOwnerProfileByUserId(userId);
  if (!existing) {
    throw new AppError("PROFILE_NOT_FOUND");
  }

  try {
    const updated = await updateOwnerProfileByUserId(userId, input);
    return toOwnerProfileResponse(updated);
  } catch (error) {
    // 사전 조회 이후 프로필이 사라진 경우만 비즈니스 에러로 변환
    if (isRecordNotFound(error) && !(await findOwnerProfileByUserId(userId))) {
      throw new AppError("PROFILE_NOT_FOUND");
    }
    throw error;
  }
}

type SitterProfileRecord = NonNullable<Awaited<ReturnType<typeof findSitterProfileByUserId>>>;

function toSitterProfileResponse(profile: SitterProfileRecord) {
  return {
    id: profile.id.toString(),
    userId: profile.userId.toString(),
    profileImageUrl: profile.profileImageUrl ?? null,
    gender: profile.gender,
    shortIntroduction: profile.shortIntroduction,
    description: profile.description ?? null,
    serviceTypes: profile.sitterServices.map((service) => service.serviceType),
    serviceRegions: profile.sitterServiceRegions.map((item) => item.region),
  };
}

export async function getSitterProfile(userId: bigint) {
  const profile = await findSitterProfileByUserId(userId);

  if (!profile) {
    throw new AppError("PROFILE_NOT_FOUND");
  }

  return toSitterProfileResponse(profile);
}
