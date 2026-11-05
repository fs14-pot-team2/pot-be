import AppError from "../errors/app-error.js";
import * as userRepository from "../repositories/user-repository.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import type { UpdateMeInput } from "../validators/user-validator.js";

export async function getMe(userId: bigint) {
  const user = await userRepository.findUserById(userId);

  if (!user) throw new AppError("UNAUTHORIZED");
  return user;
}

export async function verifyMyPassword(userId: bigint, password: string) {
  const user = await userRepository.findUserWithPasswordHashById(userId);
  if (!user) throw new AppError("UNAUTHORIZED");

  const matched = await verifyPassword(password, user.passwordHash);
  if (!matched) throw new AppError("PASSWORD_MISMATCH");

  // passwordHash는 응답에 포함하지 않도록 필요한 필드만 반환
  return {
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
      nickname: user.nickname,
    },
  };
}

export async function updateMe(userId: bigint, input: UpdateMeInput) {
  const user = await userRepository.findUserForUpdateById(userId);
  if (!user) throw new AppError("UNAUTHORIZED");

  const { nickname, password } = input;

  // 바꿀 내용이 없어도 허용 (그대로 반환)
  if (nickname === undefined && password === undefined) return user;

  // 같은 역할 안에서 닉네임 중복 확인 (자기 현재 닉네임은 통과)
  if (nickname !== undefined && nickname !== user.nickname) {
    if (await userRepository.findUserByNicknameAndRole(nickname, user.role)) {
      throw new AppError("NICKNAME_ALREADY_EXISTS");
    }
  }

  const data: { nickname?: string; passwordHash?: string } = {};
  if (nickname !== undefined) data.nickname = nickname;
  if (password !== undefined) data.passwordHash = await hashPassword(password);

  try {
    return await userRepository.updateUserById(userId, data);
  } catch (error) {
    // 사전 조회 이후 동시에 같은 닉네임이 생긴 경우
    if (getUniqueConstraintName(error) === "User_nickname_role_key") {
      throw new AppError("NICKNAME_ALREADY_EXISTS");
    }
    throw error;
  }
}
