import AppError from "../errors/app-error.js";
import * as userRepository from "../repositories/user-repository.js";

export async function getMe(userId: bigint) {
  const user = await userRepository.findUserById(userId);

  if (!user) throw new AppError("UNAUTHORIZED");
  return user;
}
