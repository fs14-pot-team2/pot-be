import argon2 from "argon2";

import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import type { SignupInput } from "../validators/auth-validator.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

async function assertNotTaken(email: string, nickname: string, role: SignupInput["role"]) {
  const [emailTaken, nicknameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email_role: { email, role } } }),
    prisma.user.findUnique({ where: { nickname_role: { nickname, role } } }),
  ]);
  if (emailTaken) throw new AppError("EMAIL_ALREADY_EXISTS");
  if (nicknameTaken) throw new AppError("NICKNAME_ALREADY_EXISTS");
}

export async function signup(input: SignupInput) {
  const { email, password, nickname, role } = input;

  await assertNotTaken(email, nickname, role);

  const passwordHash = await argon2.hash(password);

  try {
    return await prisma.user.create({
      data: {
        email,
        passwordHash,
        nickname,
        role,
        ...(role === "OWNER" && { ownerProfile: { create: {} } }),
      },
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      await assertNotTaken(email, nickname, role);
    }
    throw error;
  }
}
