export const SOCIAL_PROVIDERS = ["KAKAO", "GOOGLE"] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}
