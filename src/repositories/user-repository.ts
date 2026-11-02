import { prisma } from "../config/prisma.js";
import type { DbClient } from "../types/db.js";

// 사용자 ID 기준 조회 (passwordHash는 select에서 제외)
export function findUserById(userId: bigint, db: DbClient = prisma) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      email: true,
      nickname: true,
      createdAt: true,
    },
  });
}
