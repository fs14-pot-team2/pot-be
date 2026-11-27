import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validateSitterListQuery } from "../src/validators/sitter-validator.js";

describe("팟트너 검색어 검증", () => {
  it("keyword에 NUL 문자가 있으면 INVALID_REQUEST다", () => {
    for (const keyword of ["\0", "a\0b", "\0초록", "초록\0"]) {
      assert.throws(() => validateSitterListQuery({ keyword }), new AppError("INVALID_REQUEST"));
    }
  });

  it("정상 검색어는 앞뒤 공백을 제거해 반환한다", () => {
    assert.equal(validateSitterListQuery({ keyword: " 초록 " }).keyword, "초록");
  });

  it("keyword가 없거나 공백뿐이면 undefined다", () => {
    assert.equal(validateSitterListQuery({}).keyword, undefined);
    assert.equal(validateSitterListQuery({ keyword: "  " }).keyword, undefined);
  });
});
