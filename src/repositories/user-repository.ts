import { prisma } from "../config/prisma.js";
import type { DbClient } from "../types/db.js";
import type { UserRole } from "../types/auth.js";

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

// 비밀번호 검증용: passwordHash 포함. 응답에 그대로 쓰지 말 것
export function findUserWithPasswordHashById(userId: bigint, db: DbClient = prisma) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      email: true,
      nickname: true,
      passwordHash: true,
    },
  });
}

// 수정 응답용 조회 (updatedAt 포함, passwordHash 제외)
export function findUserForUpdateById(userId: bigint, db: DbClient = prisma) {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, nickname: true, updatedAt: true },
  });
}

export function findUserByNicknameAndRole(nickname: string, role: UserRole, db: DbClient = prisma) {
  return db.user.findUnique({
    where: { nickname_role: { nickname, role } },
    select: { id: true },
  });
}

export function updateUserById(
  userId: bigint,
  data: { nickname?: string; passwordHash?: string },
  db: DbClient = prisma,
) {
  return db.user.update({
    where: { id: userId },
    data,
    select: { id: true, role: true, email: true, nickname: true, updatedAt: true },
  });
}
