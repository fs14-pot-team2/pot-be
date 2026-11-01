import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/utils/password.js";

test("비밀번호 해싱 및 검증", async () => {
  const password = "PotTest!2026";
  const hash = await hashPassword(password);

  assert.equal(hash.startsWith("$argon2id$"), true);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("WrongPassword", hash), false);
});
