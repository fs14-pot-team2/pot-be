import argon2 from "argon2";

import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import type { SignupInput } from "../validators/auth-validator.js";

export async function signup(input: SignupInput) {
  const { email, password, nickname, role } = input;

  const [emailTaken, nicknameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email_role: { email, role } } }),
    prisma.user.findUnique({ where: { nickname_role: { nickname, role } } }),
  ]);
  if (emailTaken) throw new AppError("EMAIL_ALREADY_EXISTS");
  if (nicknameTaken) throw new AppError("NICKNAME_ALREADY_EXISTS");

  const passwordHash = await argon2.hash(password);

  return prisma.user.create({
    data: { email, passwordHash, nickname, role },
    select: { id: true, email: true, nickname: true, role: true },
  });
}
