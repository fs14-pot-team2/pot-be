import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { verifyMyPassword } from "../src/services/user-service.js";
import { hashPassword } from "../src/utils/password.js";
import { validateVerifyPassword } from "../src/validators/user-validator.js";

const PREFIX = `vp-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Password1!";

async function createUser(role: "OWNER" | "SITTER" = "OWNER") {
  return prisma.user.create({
    data: {
      email: `${PREFIX}-${randomUUID()}@example.com`,
      nickname: `${PREFIX}-${randomUUID().slice(0, 4)}`,
      passwordHash: await hashPassword(PASSWORD),
      role,
    },
  });
}

function assertAppError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("비밀번호 확인", () => {
  it("올바른 비밀번호면 사용자 정보를 반환하고 passwordHash는 포함하지 않는다", async () => {
    const user = await createUser();

    const result = await verifyMyPassword(user.id, PASSWORD);

    assert.equal(result.user.email, user.email);
    assert.equal(result.user.nickname, user.nickname);
    assert.equal(result.user.role, "OWNER");
    assert.ok(!("passwordHash" in result.user));
  });

  it("팟트너도 확인할 수 있다", async () => {
    const user = await createUser("SITTER");

    const result = await verifyMyPassword(user.id, PASSWORD);

    assert.equal(result.user.role, "SITTER");
  });

  it("틀린 비밀번호는 401 PASSWORD_MISMATCH를 반환한다", async () => {
    const user = await createUser();

    await assert.rejects(
      () => verifyMyPassword(user.id, "WrongPass1!"),
      assertAppError("PASSWORD_MISMATCH", 401),
    );
  });

  it("존재하지 않는 사용자는 401 UNAUTHORIZED를 반환한다", async () => {
    await assert.rejects(
      () => verifyMyPassword(999999999999n, PASSWORD),
      assertAppError("UNAUTHORIZED", 401),
    );
  });

  describe("요청 검증", () => {
    const invalidBodies: Array<[string, unknown]> = [
      ["body 없음", undefined],
      ["null", null],
      ["password 없음", {}],
      ["빈 문자열", { password: "" }],
      ["숫자 타입", { password: 12345678 }],
    ];

    for (const [title, body] of invalidBodies) {
      it(`${title}이면 INVALID_REQUEST를 반환한다`, () => {
        assert.throws(() => validateVerifyPassword(body), assertAppError("INVALID_REQUEST", 400));
      });
    }

    it("형식에 맞지 않는 문자열도 통과시킨다 (맞는지는 service에서 판단)", () => {
      assert.deepEqual(validateVerifyPassword({ password: "x" }), { password: "x" });
    });
  });
});
