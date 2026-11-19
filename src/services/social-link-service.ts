import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  createSocialAccount,
  findSocialAccount,
  findSocialAccountByUserId,
} from "../repositories/social-account-repository.js";
import type { AuthUser } from "../types/auth.js";
import type { DbClient } from "../types/db.js";
import type { SocialProvider } from "../types/social.js";
import { fetchGoogleProfile } from "../utils/google-client.js";
import { fetchKakaoProfile } from "../utils/kakao-client.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import type { GoogleLinkInput, KakaoLinkInput } from "../validators/social-auth-validator.js";
import { SOCIAL_PROVIDER_UNIQUE_INDEX, SOCIAL_USER_UNIQUE_INDEX } from "./social-auth-service.js";

interface LinkSocialAccountInput {
  provider: SocialProvider;
  userId: bigint;
  providerUserId: string;
  role: AuthUser["role"];
}

export async function linkSocialAccount(input: LinkSocialAccountInput, db: DbClient = prisma) {
  const { provider, userId, providerUserId, role } = input;

  // 사전 검증: 대부분의 충돌은 여기서 걸러진다.
  const [linkedToMe, linkedToSomeone] = await Promise.all([
    findSocialAccountByUserId(provider, userId, db),
    findSocialAccount(provider, providerUserId, role, db),
  ]);
  if (linkedToMe || linkedToSomeone) throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");

  try {
    return await createSocialAccount({ provider, userId, providerUserId, role }, db);
  } catch (error) {
    const constraintName = getUniqueConstraintName(error);
    if (
      constraintName === SOCIAL_PROVIDER_UNIQUE_INDEX ||
      constraintName === SOCIAL_USER_UNIQUE_INDEX
    ) {
      throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");
    }
    throw error; // 식별되지 않은 오류는 원본 그대로 전파
  }
}

// 기존 카카오 호출부와 테스트를 바꾸지 않기 위한 래퍼다.
export function linkKakaoAccount(
  input: Omit<LinkSocialAccountInput, "provider">,
  db: DbClient = prisma,
) {
  return linkSocialAccount({ ...input, provider: "KAKAO" }, db);
}

async function connectSocialAccount(
  user: AuthUser,
  provider: SocialProvider,
  fetchProfile: () => Promise<{ providerUserId: string }>,
) {
  // 외부 호출 전 빠른 거절용. 최종 정합성은 linkSocialAccount의 사전 검증과 DB UNIQUE 제약이 보장한다.
  if (await findSocialAccountByUserId(provider, user.id)) {
    throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");
  }

  const { providerUserId } = await fetchProfile();
  return linkSocialAccount({ provider, userId: user.id, providerUserId, role: user.role });
}

export function connectKakaoAccount(user: AuthUser, { code, redirectUri }: KakaoLinkInput) {
  return connectSocialAccount(user, "KAKAO", () => fetchKakaoProfile(code, redirectUri));
}

export function connectGoogleAccount(user: AuthUser, { code, redirectUri }: GoogleLinkInput) {
  return connectSocialAccount(user, "GOOGLE", () => fetchGoogleProfile(code, redirectUri));
}
