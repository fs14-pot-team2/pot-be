import { prisma } from "../config/prisma.js";
import type { UserRole } from "../types/auth.js";
import type { DbClient } from "../types/db.js";
import type { SocialProvider } from "../types/social.js";

// 소셜 계정 연동 여부 조회 (provider + providerUserId + 역할 기준)
export function findSocialAccount(
  provider: SocialProvider,
  providerUserId: string,
  role: UserRole,
  db: DbClient = prisma,
) {
  return db.socialAccount.findUnique({
    where: { provider_providerUserId_role: { provider, providerUserId, role } },
    select: { id: true },
  });
}

// 사용자의 소셜 연동 여부 조회 (userId + provider 기준)
export function findSocialAccountByUserId(
  provider: SocialProvider,
  userId: bigint,
  db: DbClient = prisma,
) {
  return db.socialAccount.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { id: true },
  });
}

// 소셜 계정 연동 생성
export function createSocialAccount(
  data: { provider: SocialProvider; userId: bigint; providerUserId: string; role: UserRole },
  db: DbClient = prisma,
) {
  return db.socialAccount.create({
    data,
    select: { id: true },
  });
}

// 소셜 연동 계정과 연결된 사용자 조회 (소셜 로그인용)
export function findSocialAccountWithUser(
  provider: SocialProvider,
  providerUserId: string,
  role: UserRole,
  db: DbClient = prisma,
) {
  return db.socialAccount.findUnique({
    where: { provider_providerUserId_role: { provider, providerUserId, role } },
    select: {
      user: { select: { id: true, email: true, nickname: true, role: true, createdAt: true } },
    },
  });
}

// 아래는 기존 카카오 호출부를 바꾸지 않기 위한 래퍼다.
export function findKakaoAccount(providerUserId: string, role: UserRole, db: DbClient = prisma) {
  return findSocialAccount("KAKAO", providerUserId, role, db);
}

export function findKakaoAccountByUserId(userId: bigint, db: DbClient = prisma) {
  return findSocialAccountByUserId("KAKAO", userId, db);
}

export function createKakaoAccount(
  data: { userId: bigint; providerUserId: string; role: UserRole },
  db: DbClient = prisma,
) {
  return createSocialAccount({ ...data, provider: "KAKAO" }, db);
}

export function findKakaoAccountWithUser(
  providerUserId: string,
  role: UserRole,
  db: DbClient = prisma,
) {
  return findSocialAccountWithUser("KAKAO", providerUserId, role, db);
}
