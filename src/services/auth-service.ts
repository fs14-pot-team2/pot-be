import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import type { DbClient } from "../types/db.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import type { LoginInput, SignupInput } from "../validators/auth-validator.js";

const EMAIL_UNIQUE_INDEX = "User_email_role_key";
const NICKNAME_UNIQUE_INDEX = "User_nickname_role_key";

async function assertNotTaken(
  email: string,
  nickname: string,
  role: SignupInput["role"],
  db: DbClient = prisma,
) {
  const [emailTaken, nicknameTaken] = await Promise.all([
    db.user.findUnique({ where: { email_role: { email, role } } }),
    db.user.findUnique({ where: { nickname_role: { nickname, role } } }),
  ]);
  if (emailTaken) throw new AppError("EMAIL_ALREADY_EXISTS");
  if (nicknameTaken) throw new AppError("NICKNAME_ALREADY_EXISTS");
}

export async function signup(input: SignupInput, db: DbClient = prisma) {
  const { email, password, nickname, role } = input;

  await assertNotTaken(email, nickname, role, db);

  const passwordHash = await hashPassword(password);

  try {
    return await db.user.create({
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
    // 사전 조회 이후 동시에 같은 이메일·닉네임이 생긴 경우만 비즈니스 에러로 변환
    const constraintName = getUniqueConstraintName(error);

    if (constraintName === EMAIL_UNIQUE_INDEX) throw new AppError("EMAIL_ALREADY_EXISTS");
    if (constraintName === NICKNAME_UNIQUE_INDEX) throw new AppError("NICKNAME_ALREADY_EXISTS");

    // 충돌 원인을 식별할 수 없으면 원본 오류 전파
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
