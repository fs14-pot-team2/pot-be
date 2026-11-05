import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { updateMe } from "../src/services/user-service.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import { validateUpdateMe } from "../src/validators/user-validator.js";

const PREFIX = `up-${randomUUID().slice(0, 8)}`;

// 닉네임 정책(한영숫자 2~7자)을 만족하는 랜덤 닉네임
function shortNickname() {
  return randomUUID().replace(/-/g, "").slice(0, 7);
}

async function createUser(role: "OWNER" | "SITTER" = "OWNER") {
  return prisma.user.create({
    data: {
      email: `${PREFIX}-${randomUUID()}@example.com`,
      nickname: shortNickname(),
      passwordHash: await hashPassword("Password1!"),
      role,
    },
  });
}

function assertAppError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("본인 개인정보 수정", () => {
  it("닉네임을 수정하고 passwordHash는 포함하지 않는다", async () => {
    const user = await createUser();
    const nickname = shortNickname();

    const result = await updateMe(user.id, validateUpdateMe({ nickname }));

    assert.equal(result.nickname, nickname);
    assert.equal(result.email, user.email);
    assert.ok(!("passwordHash" in result));
  });

  it("비밀번호를 수정하면 새 비밀번호로 확인된다", async () => {
    const user = await createUser();

    // 비밀번호 수정
    await updateMe(user.id, validateUpdateMe({ password: "NewPass1!" }));

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(await verifyPassword("NewPass1!", saved.passwordHash));
  });

  it("바꿀 내용이 없어도 200 응답 데이터를 반환한다", async () => {
    const user = await createUser();

    const result = await updateMe(user.id, {});

    assert.equal(result.id, user.id);
    assert.equal(result.nickname, user.nickname);
    assert.ok(result.updatedAt instanceof Date);
  });

  it("자기 현재 닉네임으로 수정해도 통과한다", async () => {
    const user = await createUser();

    // 자기 현재 닉네임
    const result = await updateMe(user.id, validateUpdateMe({ nickname: user.nickname }));

    assert.equal(result.nickname, user.nickname);
  });

  it("같은 역할의 중복 닉네임은 409 NICKNAME_ALREADY_EXISTS를 반환한다", async () => {
    const user = await createUser();
    const other = await createUser();

    await assert.rejects(
      //같은 역할 중복
      () => updateMe(user.id, validateUpdateMe({ nickname: other.nickname })),
      assertAppError("NICKNAME_ALREADY_EXISTS", 409),
    );
  });

  it("다른 역할이면 같은 닉네임을 쓸 수 있다", async () => {
    const owner = await createUser("OWNER");
    const sitter = await createUser("SITTER");

    // 다른 역할 같은 닉네임
    const result = await updateMe(sitter.id, validateUpdateMe({ nickname: owner.nickname }));

    assert.equal(result.nickname, owner.nickname);
  });

  it("존재하지 않는 사용자는 401 UNAUTHORIZED를 반환한다", async () => {
    await assert.rejects(
      () => updateMe(999999999999n, { nickname: "abc" }),
      assertAppError("UNAUTHORIZED", 401),
    );
  });

  describe("요청 검증", () => {
    it("빈 객체는 통과한다", () => {
      assert.deepEqual(validateUpdateMe({}), {});
    });

    it("email은 무시한다", () => {
      assert.deepEqual(validateUpdateMe({ email: "a@b.com" }), {});
    });

    it("body가 없으면 INVALID_REQUEST", () => {
      assert.throws(() => validateUpdateMe(undefined), assertAppError("INVALID_REQUEST", 400));
    });

    it("배열 body는 INVALID_REQUEST", () => {
      assert.throws(() => validateUpdateMe([]), assertAppError("INVALID_REQUEST", 400));
    });

    it("형식이 틀린 닉네임은 INVALID_NICKNAME_FORMAT", () => {
      assert.throws(
        () => validateUpdateMe({ nickname: "a" }),
        assertAppError("INVALID_NICKNAME_FORMAT", 400),
      );
    });

    it("형식이 틀린 비밀번호는 INVALID_PASSWORD_FORMAT", () => {
      assert.throws(
        () => validateUpdateMe({ password: "short" }),
        assertAppError("INVALID_PASSWORD_FORMAT", 400),
      );
    });

    for (const nickname of ["가", "12345678", "a-b", "a b", "닉네임!"]) {
      it(`닉네임 "${nickname}"은 INVALID_NICKNAME_FORMAT이다`, () => {
        assert.throws(
          () => validateUpdateMe({ nickname }),
          assertAppError("INVALID_NICKNAME_FORMAT", 400),
        );
      });
    }
  });
});
