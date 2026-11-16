import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { generateRandomNickname } from "../utils/random-nickname.js";
import type { SignupInput } from "../validators/auth-validator.js";

const MAX_NICKNAME_ATTEMPTS = 10;

type UniqueTarget = "nickname" | "email" | "social";

// P2002가 어떤 유니크 제약에서 났는지 구분한다.
// 드라이버 어댑터를 쓰면 meta.target 형태가 다를 수 있어서 meta 전체를 문자열로 검사한다.
function getUniqueViolationTarget(error: unknown): UniqueTarget | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code !== "P2002") return null;

  const raw = JSON.stringify(meta ?? {});
  if (raw.includes("nickname")) return "nickname";
  if (raw.includes("email")) return "email";
  return "social"; // (provider, providerUserId, role) 또는 (userId, provider)
}

interface CreateSocialUserInput {
  email: string;
  providerUserId: string;
  role: SignupInput["role"];
  passwordHash: string;
}

export async function createSocialUser(input: CreateSocialUserInput) {
  const { email, providerUserId, role, passwordHash } = input;

  // 사전 검증: 대부분의 충돌은 여기서 걸러진다.
  const [emailTaken, socialLinked] = await Promise.all([
    prisma.user.findUnique({ where: { email_role: { email, role } } }),
    prisma.socialAccount.findUnique({
      where: { provider_providerUserId_role: { provider: "KAKAO", providerUserId, role } },
    }),
  ]);
  if (emailTaken) throw new AppError("SOCIAL_EMAIL_ALREADY_EXISTS");
  if (socialLinked) throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");

  for (let attempt = 0; attempt < MAX_NICKNAME_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            role,
            nickname: generateRandomNickname(),
            ...(role === "OWNER" && { ownerProfile: { create: {} } }),
          },
          select: { id: true, email: true, nickname: true, role: true, createdAt: true },
        });

        await tx.socialAccount.create({
          data: { userId: user.id, provider: "KAKAO", providerUserId, role },
        });

        return user;
      });
    } catch (error) {
      const target = getUniqueViolationTarget(error);
      if (target === "nickname") continue; // 닉네임 충돌만 재시도
      if (target === "email") throw new AppError("SOCIAL_EMAIL_ALREADY_EXISTS");
      if (target === "social") throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");
      throw error;
    }
  }

  throw new AppError("INTERNAL_SERVER_ERROR");
}
