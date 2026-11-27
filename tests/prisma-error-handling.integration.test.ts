import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { signup } from "../src/services/auth-service.js";
import { updateOwnerProfile } from "../src/services/profile-service.js";
import type { DbClient } from "../src/types/db.js";

const signupInput = {
  email: "prisma-error@example.com",
  nickname: "prisma-error",
  password: "test-password1!",
  role: "OWNER" as const,
};

function uniqueError(index?: string) {
  return Object.assign(new Error("unique"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index } } } },
  });
}

// 사전 조회는 통과하고 생성 시점에만 실패하는 DB
function signupDb(error: Error) {
  return {
    user: {
      findUnique: async () => null,
      create: async () => {
        throw error;
      },
    },
  } as unknown as DbClient;
}

// 조회 결과를 순서대로 반환하고 수정 시점에 실패하는 DB
function profileDb(error: Error, lookups: unknown[]) {
  return {
    ownerProfile: {
      findUnique: async () => lookups.shift(),
      update: async () => {
        throw error;
      },
    },
  } as unknown as DbClient;
}

describe("일반 회원가입 P2002 처리", () => {
  for (const [index, code] of [
    ["User_email_role_key", "EMAIL_ALREADY_EXISTS"],
    ["User_nickname_role_key", "NICKNAME_ALREADY_EXISTS"],
  ] as const) {
    it(`${index} 충돌은 ${code}로 변환한다`, async () => {
      await assert.rejects(signup(signupInput, signupDb(uniqueError(index))), new AppError(code));
    });
  }

  it("충돌 원인을 식별할 수 없으면 원본 오류를 전파한다", async () => {
    const error = uniqueError();

    await assert.rejects(signup(signupInput, signupDb(error)), (actual) => actual === error);
  });
});

describe("팟오너 프로필 수정 P2025 처리", () => {
  const error = Object.assign(new Error("not found"), { code: "P2025" });

  it("재조회에서 프로필이 없으면 PROFILE_NOT_FOUND다", async () => {
    await assert.rejects(
      updateOwnerProfile(1n, {}, profileDb(error, [{}, null])),
      new AppError("PROFILE_NOT_FOUND"),
    );
  });

  it("재조회에서 프로필이 있으면 원본 오류를 전파한다", async () => {
    await assert.rejects(
      updateOwnerProfile(1n, {}, profileDb(error, [{}, {}])),
      (actual) => actual === error,
    );
  });
});
