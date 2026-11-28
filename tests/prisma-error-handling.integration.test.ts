import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { signup } from "../src/services/auth-service.js";
import { updateOwnerProfile } from "../src/services/profile-service.js";
import type { DbClient } from "../src/types/db.js";

// 테스트마다 겹치지 않는 회원가입 입력 생성
function createSignupInput() {
  const uniqueId = randomUUID();
  return {
    email: `prisma-error-${uniqueId}@example.com`,
    nickname: `prisma-error-${uniqueId}`,
    password: "test-password1!",
    role: "OWNER" as const,
  };
}

// 프로필을 가진 테스트 팟오너 생성
async function createTestOwner() {
  const uniqueId = randomUUID();
  return prisma.user.create({
    data: {
      email: `prisma-error-${uniqueId}@example.com`,
      nickname: `prisma-error-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
    select: { id: true },
  });
}

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName?: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index: constraintName } } } },
  });
}

// 사전 조회는 실제 DB로 실행하고, 사용자 생성 시점에만 오류를 주입한다.
function createFailingSignupDb(error: Error) {
  return new Proxy(prisma, {
    get(target, property) {
      if (property === "user") {
        return {
          findUnique: (args: never) => target.user.findUnique(args),
          create: async () => {
            throw error;
          },
        };
      }
      return target[property as keyof typeof target];
    },
  }) as unknown as DbClient;
}

// 프로필 조회는 실제 DB로 실행하고, 수정 시점의 동작만 바꾼다.
function createProfileUpdateDb(onUpdate: (args: never) => Promise<unknown>) {
  const calls = { findUnique: 0, update: 0 };
  const db = new Proxy(prisma, {
    get(target, property) {
      if (property === "ownerProfile") {
        return {
          findUnique: (args: never) => {
            calls.findUnique += 1;
            return target.ownerProfile.findUnique(args);
          },
          update: (args: never) => {
            calls.update += 1;
            return onUpdate(args);
          },
        };
      }
      return target[property as keyof typeof target];
    },
  }) as unknown as DbClient;

  return { db, calls };
}

describe("일반 회원가입 P2002 처리", () => {
  for (const [constraintName, code] of [
    ["User_email_role_key", "EMAIL_ALREADY_EXISTS"],
    ["User_nickname_role_key", "NICKNAME_ALREADY_EXISTS"],
  ] as const) {
    it(`${constraintName} 충돌은 ${code}로 변환한다`, async () => {
      const input = createSignupInput();

      await assert.rejects(
        signup(input, createFailingSignupDb(createP2002Error(constraintName))),
        new AppError(code),
      );
      assert.equal(await prisma.user.count({ where: { email: input.email } }), 0);
    });
  }

  it("충돌 원인을 식별할 수 없으면 원본 오류를 전파한다", async () => {
    const error = createP2002Error();

    await assert.rejects(
      signup(createSignupInput(), createFailingSignupDb(error)),
      (actual) => actual === error,
    );
  });
});

describe("팟오너 프로필 수정 P2025 처리", () => {
  it("수정 직전에 프로필이 삭제되면 PROFILE_NOT_FOUND다", async () => {
    const owner = await createTestOwner();
    // 재조회 조건이 대상 사용자로 한정되지 않으면 이 프로필이 조회되어 테스트가 실패한다.
    await createTestOwner();

    // 첫 조회 이후 프로필을 삭제하고 실제 수정을 실행해 Prisma가 P2025를 던지게 한다.
    const { db, calls } = createProfileUpdateDb(async (args) => {
      await prisma.ownerProfile.delete({ where: { userId: owner.id } });
      return prisma.ownerProfile.update(args);
    });

    await assert.rejects(updateOwnerProfile(owner.id, {}, db), new AppError("PROFILE_NOT_FOUND"));
    assert.deepEqual(calls, { findUnique: 2, update: 1 });
  });

  it("재조회에서 프로필이 있으면 원본 오류를 전파한다", async () => {
    const owner = await createTestOwner();
    // 프로필이 남아 있는데 P2025가 나는 상황은 재현하기 어려워 오류를 주입한다.
    const error = Object.assign(new Error("Record not found"), { code: "P2025" });
    const { db, calls } = createProfileUpdateDb(async () => {
      throw error;
    });

    await assert.rejects(updateOwnerProfile(owner.id, {}, db), (actual) => actual === error);
    assert.deepEqual(calls, { findUnique: 2, update: 1 });
  });
});
