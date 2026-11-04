import AppError from "../errors/app-error.js";
import * as userRepository from "../repositories/user-repository.js";
import { verifyPassword } from "../utils/password.js";

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
