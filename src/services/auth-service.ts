import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import type { LoginInput, SignupInput } from "../validators/auth-validator.js";

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

  const passwordHash = await hashPassword(password);

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

export async function login(input: LoginInput) {
  const { email, password, role } = input;

  const user = await prisma.user.findUnique({
    where: { email_role: { email, role } },
    select: {
      id: true,
      email: true,
      nickname: true,
      role: true,
      createdAt: true,
      passwordHash: true,
    },
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS");
  }

  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    createdAt: user.createdAt,
  };
}
