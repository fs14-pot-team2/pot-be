import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { linkKakaoAccount } from "../src/services/social-link-service.js";
import type { DbClient } from "../src/types/db.js";

type Role = "OWNER" | "SITTER";

// 테스트마다 겹치지 않는 사용자 생성
async function createTestUser(role: Role) {
  const uniqueId = randomUUID();
  return prisma.user.create({
    data: {
      email: `link-${uniqueId}@example.com`,
      nickname: `link-${uniqueId}`,
      passwordHash: "test-only",
      role,
    },
    select: { id: true },
  });
}

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index: constraintName } } } },
  });
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("카카오 계정 연동 동시성", () => {
  for (const role of ["OWNER", "SITTER"] as const) {
    // 같은 사용자가 서로 다른 카카오 계정으로 동시에 연동해도 한 건만 저장되는지 확인
    it(`${role}: 같은 사용자의 동시 연동은 한 건만 성공한다`, async () => {
      const user = await createTestUser(role);

      const results = await Promise.allSettled([
        linkKakaoAccount({ userId: user.id, providerUserId: `kakao-${randomUUID()}`, role }),
        linkKakaoAccount({ userId: user.id, providerUserId: `kakao-${randomUUID()}`, role }),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("SOCIAL_ACCOUNT_ALREADY_LINKED")(rejected[0].reason));
      assert.equal(await prisma.socialAccount.count({ where: { userId: user.id } }), 1);
    });

    // 서로 다른 사용자가 같은 카카오 계정으로 동시에 연동해도 한 건만 저장되는지 확인
    it(`${role}: 같은 카카오 계정의 동시 연동은 한 건만 성공한다`, async () => {
      const [first, second] = await Promise.all([createTestUser(role), createTestUser(role)]);
      const providerUserId = `kakao-${randomUUID()}`;

      const results = await Promise.allSettled([
        linkKakaoAccount({ userId: first.id, providerUserId, role }),
        linkKakaoAccount({ userId: second.id, providerUserId, role }),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("SOCIAL_ACCOUNT_ALREADY_LINKED")(rejected[0].reason));
      assert.equal(
        await prisma.socialAccount.count({ where: { provider: "KAKAO", providerUserId, role } }),
        1,
      );
    });
  }

  describe("UNIQUE 제약 충돌 처리", () => {
    // 사전 검증을 통과한 뒤 생성 시점에 P2002가 나는 상황을 결정적으로 재현한다.
    function createFailingCreateDb(constraintName: string) {
      return new Proxy(prisma, {
        get(target, property) {
          if (property === "socialAccount") {
            return {
              findUnique: (args: never) => target.socialAccount.findUnique(args),
              create: async () => {
                throw createP2002Error(constraintName);
              },
            };
          }
          return target[property as keyof typeof target];
        },
      }) as unknown as DbClient;
    }

    for (const constraintName of [
      "SocialAccount_userId_provider_key",
      "SocialAccount_provider_providerUserId_role_key",
    ] as const) {
      // 두 UNIQUE 제약 모두 SOCIAL_ACCOUNT_ALREADY_LINKED로 변환되는지 확인
      it(`${constraintName} 충돌 시 SOCIAL_ACCOUNT_ALREADY_LINKED를 반환한다`, async () => {
        const user = await createTestUser("OWNER");

        await assert.rejects(
          linkKakaoAccount(
            { userId: user.id, providerUserId: `kakao-${randomUUID()}`, role: "OWNER" },
            createFailingCreateDb(constraintName),
          ),
          assertAppError("SOCIAL_ACCOUNT_ALREADY_LINKED"),
        );
        assert.equal(await prisma.socialAccount.count({ where: { userId: user.id } }), 0);
      });
    }
  });
});
