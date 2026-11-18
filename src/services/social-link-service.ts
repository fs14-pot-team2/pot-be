import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  createKakaoAccount,
  findKakaoAccount,
  findKakaoAccountByUserId,
} from "../repositories/social-account-repository.js";
import type { AuthUser } from "../types/auth.js";
import type { DbClient } from "../types/db.js";
import { fetchKakaoProfile } from "../utils/kakao-client.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import type { KakaoLinkInput } from "../validators/social-auth-validator.js";
import { SOCIAL_PROVIDER_UNIQUE_INDEX, SOCIAL_USER_UNIQUE_INDEX } from "./social-auth-service.js";

interface LinkKakaoAccountInput {
  userId: bigint;
  providerUserId: string;
  role: AuthUser["role"];
}

export async function linkKakaoAccount(input: LinkKakaoAccountInput, db: DbClient = prisma) {
  const { userId, providerUserId, role } = input;

  // 사전 검증: 대부분의 충돌은 여기서 걸러진다.
  const [linkedToMe, linkedToSomeone] = await Promise.all([
    findKakaoAccountByUserId(userId, db),
    findKakaoAccount(providerUserId, role, db),
  ]);
  if (linkedToMe || linkedToSomeone) throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");

  try {
    return await createKakaoAccount({ userId, providerUserId, role }, db);
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

export async function connectKakaoAccount(user: AuthUser, { code, redirectUri }: KakaoLinkInput) {
  // 외부 호출 전 빠른 거절용. 최종 정합성은 linkKakaoAccount의 사전 검증과 DB UNIQUE 제약이 보장한다.
  if (await findKakaoAccountByUserId(user.id)) {
    throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");
  }

  const { providerUserId } = await fetchKakaoProfile(code, redirectUri);
  return linkKakaoAccount({ userId: user.id, providerUserId, role: user.role });
}
