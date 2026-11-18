import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { completeKakaoSignup, createSocialUser } from "../src/services/social-auth-service.js";
import type { TransactionRunner } from "../src/types/db.js";
import type { SocialSignupPayload } from "../src/utils/jwt.js";

const PASSWORD = "Password123!";

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index: constraintName } } } },
  });
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(codes: string[], statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && codes.includes(error.code) && error.statusCode === statusCode;
}

// 테스트마다 겹치지 않는 가입 토큰 payload 생성
function createPayload(
  role: SocialSignupPayload["role"],
  overrides: Partial<SocialSignupPayload> = {},
): SocialSignupPayload {
  const uniqueId = randomUUID();
  return {
    provider: "KAKAO",
    providerUserId: `kakao-${uniqueId}`,
    email: `kakao-${uniqueId}@example.com`,
    role,
    ...overrides,
  };
}

describe("카카오 가입 완료 동시성 및 트랜잭션", () => {
  describe("동일 가입 토큰 동시 요청", () => {
    for (const role of ["OWNER", "SITTER"] as const) {
      // 같은 가입 토큰으로 동시에 요청해도 User·SocialAccount가 한 건만 생성되는지 확인
      it(`${role}: 한 건만 가입되고 나머지는 409로 거절된다`, async () => {
        const payload = createPayload(role);

        const results = await Promise.allSettled([
          completeKakaoSignup(payload, PASSWORD),
          completeKakaoSignup(payload, PASSWORD),
        ]);

        const succeeded = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );

        assert.equal(succeeded.length, 1);
        assert.equal(rejected.length, 1);
        // 사전 검증 시점에 따라 이메일 또는 카카오 계정 충돌로 확인된다.
        assert.ok(
          assertAppError(["SOCIAL_EMAIL_ALREADY_EXISTS", "SOCIAL_ACCOUNT_ALREADY_LINKED"])(
            rejected[0].reason,
          ),
        );

        const users = await prisma.user.findMany({
          where: { email: payload.email, role },
          select: { id: true },
        });
        assert.equal(users.length, 1);
        assert.equal(
          await prisma.socialAccount.count({
            where: { provider: "KAKAO", providerUserId: payload.providerUserId, role },
          }),
          1,
        );
        assert.equal(
          await prisma.ownerProfile.count({ where: { userId: users[0].id } }),
          role === "OWNER" ? 1 : 0,
        );
      });
    }

    // 이메일이 달라 User 생성은 모두 성공해도, SocialAccount UNIQUE 충돌로 진 쪽의 User·OwnerProfile이 남지 않는지 확인
    it("카카오 계정 UNIQUE 충돌로 실패한 요청의 User·OwnerProfile은 남지 않는다", async () => {
      const first = createPayload("OWNER");
      const second = createPayload("OWNER", { providerUserId: first.providerUserId });

      const results = await Promise.allSettled([
        completeKakaoSignup(first, PASSWORD),
        completeKakaoSignup(second, PASSWORD),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError(["SOCIAL_ACCOUNT_ALREADY_LINKED"])(rejected[0].reason));

      const users = await prisma.user.findMany({
        where: { email: { in: [first.email, second.email] }, role: "OWNER" },
        select: { id: true },
      });
      assert.equal(users.length, 1);
      assert.equal(await prisma.ownerProfile.count({ where: { userId: users[0].id } }), 1);
      assert.equal(
        await prisma.socialAccount.count({
          where: { provider: "KAKAO", providerUserId: first.providerUserId, role: "OWNER" },
        }),
        1,
      );
    });
  });

  describe("SocialAccount 생성 실패 시 롤백", () => {
    // User·OwnerProfile이 실제로 생성된 뒤 SocialAccount 생성이 실패하는 상황을 만든다.
    function createFailingSocialAccountRunner(constraintName: string) {
      const state: { createdUserId?: bigint } = {};

      const runTransaction: TransactionRunner = (callback) =>
        prisma.$transaction((tx) => {
          const wrappedTx = new Proxy(tx, {
            get(target, property) {
              if (property === "user") {
                return {
                  create: async (args: Prisma.UserCreateArgs) => {
                    const user = await target.user.create(args);
                    state.createdUserId = user.id;
                    return user;
                  },
                };
              }
              if (property === "socialAccount") {
                return {
                  create: async () => {
                    throw createP2002Error(constraintName);
                  },
                };
              }
              return target[property as keyof typeof target];
            },
          });

          return callback(wrappedTx as Prisma.TransactionClient);
        });

      return { state, runTransaction };
    }

    for (const [constraintName, label] of [
      ["SocialAccount_provider_providerUserId_role_key", "카카오 계정 중복"],
      ["SocialAccount_userId_provider_key", "사용자 연동 중복"],
    ] as const) {
      // SocialAccount 생성 실패 시 같은 트랜잭션의 User와 OwnerProfile이 함께 롤백되는지 확인
      it(`${label} 충돌 시 User·OwnerProfile을 롤백하고 409를 반환한다`, async () => {
        const payload = createPayload("OWNER");
        const { state, runTransaction } = createFailingSocialAccountRunner(constraintName);

        await assert.rejects(
          createSocialUser(
            {
              email: payload.email,
              providerUserId: payload.providerUserId,
              role: payload.role,
              passwordHash: "test-only",
            },
            runTransaction,
          ),
          assertAppError(["SOCIAL_ACCOUNT_ALREADY_LINKED"]),
        );

        // 롤백 검증이 의미 있으려면 실패 전에 User가 실제로 생성되어 있어야 한다.
        assert.ok(state.createdUserId !== undefined);
        assert.equal(await prisma.user.count({ where: { id: state.createdUserId } }), 0);
        assert.equal(
          await prisma.ownerProfile.count({ where: { userId: state.createdUserId } }),
          0,
        );
        assert.equal(
          await prisma.user.count({ where: { email: payload.email, role: payload.role } }),
          0,
        );
        assert.equal(
          await prisma.socialAccount.count({
            where: { providerUserId: payload.providerUserId, role: payload.role },
          }),
          0,
        );
      });
    }
  });
});
