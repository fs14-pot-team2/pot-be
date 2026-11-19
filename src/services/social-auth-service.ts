import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  createSocialAccount,
  findSocialAccount,
  findSocialAccountWithUser,
} from "../repositories/social-account-repository.js";
import { createSocialSignupUser, findUserByEmailAndRole } from "../repositories/user-repository.js";
import { signSocialSignupToken, type SocialSignupPayload } from "../utils/jwt.js";
import { fetchGoogleProfile } from "../utils/google-client.js";
import { fetchKakaoProfile } from "../utils/kakao-client.js";
import { hashPassword } from "../utils/password.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import { generateRandomNickname } from "../utils/random-nickname.js";
import type { SignupInput } from "../validators/auth-validator.js";
import type { GoogleLoginInput, KakaoLoginInput } from "../validators/social-auth-validator.js";
import type { SocialProvider } from "../types/social.js";
import type { TransactionRunner } from "../types/db.js";

const MAX_NICKNAME_ATTEMPTS = 10;

export const NICKNAME_UNIQUE_INDEX = "User_nickname_role_key";
export const EMAIL_UNIQUE_INDEX = "User_email_role_key";
export const SOCIAL_PROVIDER_UNIQUE_INDEX = "SocialAccount_provider_providerUserId_role_key";
export const SOCIAL_USER_UNIQUE_INDEX = "SocialAccount_userId_provider_key";

interface CreateSocialUserInput {
  email: string;
  provider: SocialProvider;
  providerUserId: string;
  role: SignupInput["role"];
  passwordHash: string;
}

export async function createSocialUser(
  input: CreateSocialUserInput,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const { email, provider, providerUserId, role, passwordHash } = input;

  // 사전 검증: 대부분의 충돌은 여기서 걸러진다.
  const [emailTaken, socialLinked] = await Promise.all([
    findUserByEmailAndRole(email, role),
    findSocialAccount(provider, providerUserId, role),
  ]);
  if (emailTaken) throw new AppError("SOCIAL_EMAIL_ALREADY_EXISTS");
  if (socialLinked) throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");

  for (let attempt = 0; attempt < MAX_NICKNAME_ATTEMPTS; attempt++) {
    try {
      return await runTransaction(async (tx) => {
        const user = await createSocialSignupUser(
          { email, passwordHash, role, nickname: generateRandomNickname() },
          tx,
        );
        await createSocialAccount({ provider, userId: user.id, providerUserId, role }, tx);
        return user;
      });
    } catch (error) {
      const constraintName = getUniqueConstraintName(error);

      if (constraintName === NICKNAME_UNIQUE_INDEX) continue; // 닉네임 충돌만 재시도
      if (constraintName === EMAIL_UNIQUE_INDEX) {
        throw new AppError("SOCIAL_EMAIL_ALREADY_EXISTS");
      }
      if (
        constraintName === SOCIAL_PROVIDER_UNIQUE_INDEX ||
        constraintName === SOCIAL_USER_UNIQUE_INDEX
      ) {
        throw new AppError("SOCIAL_ACCOUNT_ALREADY_LINKED");
      }
      throw error; // 식별되지 않은 오류는 원본 그대로 전파
    }
  }

  throw new AppError("INTERNAL_SERVER_ERROR");
}

export type KakaoAuthResult =
  | {
      isNewUser: false;
      user: {
        id: bigint;
        email: string;
        nickname: string;
        role: SignupInput["role"];
        createdAt: Date;
      };
    }
  | { isNewUser: true; signupToken: string };

async function authenticateWithProfile(
  provider: SocialProvider,
  role: SignupInput["role"],
  profile: { providerUserId: string; email: string },
): Promise<KakaoAuthResult> {
  const { providerUserId, email } = profile;

  const account = await findSocialAccountWithUser(provider, providerUserId, role);
  if (account) return { isNewUser: false, user: account.user };

  const emailTaken = await findUserByEmailAndRole(email, role);
  if (emailTaken) throw new AppError("SOCIAL_EMAIL_ALREADY_EXISTS");

  return {
    isNewUser: true,
    signupToken: signSocialSignupToken({ provider, providerUserId, email, role }),
  };
}

export async function authenticateWithKakao(input: KakaoLoginInput): Promise<KakaoAuthResult> {
  const profile = await fetchKakaoProfile(input.code, input.redirectUri);
  return authenticateWithProfile("KAKAO", input.role, profile);
}

export async function authenticateWithGoogle(input: GoogleLoginInput): Promise<KakaoAuthResult> {
  const profile = await fetchGoogleProfile(input.code, input.redirectUri);
  return authenticateWithProfile("GOOGLE", input.role, profile);
}

export async function completeSocialSignup(payload: SocialSignupPayload, password: string) {
  const passwordHash = await hashPassword(password);
  return createSocialUser({
    email: payload.email,
    provider: payload.provider,
    providerUserId: payload.providerUserId,
    role: payload.role,
    passwordHash,
  });
}

export const completeKakaoSignup = completeSocialSignup;
