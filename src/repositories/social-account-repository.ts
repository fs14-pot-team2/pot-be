import { prisma } from "../config/prisma.js";
import type { UserRole } from "../types/auth.js";
import type { DbClient } from "../types/db.js";

// 카카오 계정 연동 여부 조회 (providerUserId + 역할 기준)
export function findKakaoAccount(providerUserId: string, role: UserRole, db: DbClient = prisma) {
  return db.socialAccount.findUnique({
    where: { provider_providerUserId_role: { provider: "KAKAO", providerUserId, role } },
    select: { id: true },
  });
}

// 카카오 계정 연동 생성
export function createKakaoAccount(
  data: { userId: bigint; providerUserId: string; role: UserRole },
  db: DbClient = prisma,
) {
  return db.socialAccount.create({
    data: { ...data, provider: "KAKAO" },
    select: { id: true },
  });
}

// 카카오 연동 계정과 연결된 사용자 조회 (소셜 로그인용)
export function findKakaoAccountWithUser(
  providerUserId: string,
  role: UserRole,
  db: DbClient = prisma,
) {
  return db.socialAccount.findUnique({
    where: { provider_providerUserId_role: { provider: "KAKAO", providerUserId, role } },
    select: {
      user: { select: { id: true, email: true, nickname: true, role: true, createdAt: true } },
    },
  });
}
