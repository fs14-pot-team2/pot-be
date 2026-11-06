export const PROFILE_IMAGE_PREFIX = "profile-images";

export type ProfileImageRole = "OWNER" | "SITTER";

export function profileImageKeyPrefix(role: ProfileImageRole, userId: bigint) {
  return `${PROFILE_IMAGE_PREFIX}/${role.toLowerCase()}/${userId}/`;
}
