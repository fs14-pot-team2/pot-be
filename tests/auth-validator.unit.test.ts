import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validateLogin, validateSignup } from "../src/validators/auth-validator.js";

const loginBody = { email: "user@example.com", password: "Password123!", role: "OWNER" };
const signupBody = { ...loginBody, nickname: "식물사랑" };

describe("인증 요청 본문 검증", () => {
  const cases = [
    { name: "로그인", validate: validateLogin, body: loginBody },
    { name: "회원가입", validate: validateSignup, body: signupBody },
  ];

  for (const { name, validate, body } of cases) {
    it(`${name} 본문이 배열이면 INVALID_REQUEST다`, () => {
      for (const invalidBody of [[], [body]]) {
        assert.throws(() => validate(invalidBody), new AppError("INVALID_REQUEST"));
      }
    });

    it(`${name}의 정상 본문은 그대로 반환한다`, () => {
      assert.deepEqual(validate(body), body);
    });
  }
});
