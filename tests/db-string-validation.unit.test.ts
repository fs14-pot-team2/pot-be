import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { containsNullByte } from "../src/utils/db-string-validation.js";

describe("DB 입력 문자열 유효성 검증", () => {
  // NUL 문자 단독 및 위치별 포함 여부 확인
  it("NUL 문자가 포함된 문자열은 true를 반환한다", () => {
    for (const value of ["\0", "\0초록", "초\0록", "초록\0"]) {
      assert.equal(containsNullByte(value), true);
    }
  });

  // NUL 문자가 없는 일반 문자열 및 빈 문자열 처리 확인
  it("NUL 문자가 없는 문자열은 false를 반환한다", () => {
    for (const value of ["초록", "abc123", "", " ", "\n", "\t", "\\0"]) {
      assert.equal(containsNullByte(value), false);
    }
  });
});
