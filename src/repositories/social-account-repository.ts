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
