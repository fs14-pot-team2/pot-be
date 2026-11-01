import AppError from "../errors/app-error.js";
import { findOwnerProfileByUserId } from "../repositories/profile-repository.js";

export async function getOwnerProfile(userId: bigint) {
  const profile = await findOwnerProfileByUserId(userId);

  if (!profile) {
    throw new AppError("PROFILE_NOT_FOUND");
  }

  return {
    id: profile.id.toString(),
    userId: profile.userId.toString(),
    profileImageUrl: profile.profileImageUrl ?? null,
    preferredServiceTypes: profile.preferredServiceTypes ?? [],
    livingRegion: profile.livingRegion ?? null,
  };
}
