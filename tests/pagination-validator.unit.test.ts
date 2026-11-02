import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validatePagination } from "../src/validators/pagination-validator.js";

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("페이지네이션", () => {
  describe("입력값 검증", () => {
    // 페이지 및 페이지 크기 미입력 시 공통 기본값 확인
    it("페이지와 페이지 크기를 생략하면 기본값을 반환한다", () => {
      assert.deepEqual(validatePagination(undefined, undefined), { page: 1, pageSize: 8 });
    });

    // 유효한 문자열 숫자를 정수로 변환하는지 확인
    it("유효한 문자열 입력을 정수로 변환한다", () => {
      assert.deepEqual(validatePagination("2", "16"), { page: 2, pageSize: 16 });
    });

    // 공통 페이지 크기 최대값 100까지 허용 확인
    it("페이지 크기 최대값 100을 허용한다", () => {
      assert.deepEqual(validatePagination("1", "100"), { page: 1, pageSize: 100 });
    });

    // 양의 정수 외의 페이지 입력값은 페이지네이션 오류 반환 확인
    it("잘못된 페이지 입력값은 INVALID_PAGE_PARAMETER를 반환한다", () => {
      for (const value of [
        "0",
        "-1",
        "1.5",
        "01",
        "abc",
        "",
        " ",
        1,
        null,
        [],
        "9007199254740992",
      ]) {
        assert.throws(
          () => validatePagination(value, undefined),
          assertAppError("INVALID_PAGE_PARAMETER", 400),
        );
      }
    });

    // 최대값 초과와 양의 정수 외 페이지 크기는 페이지네이션 오류 반환 확인
    it("잘못된 페이지 크기는 INVALID_PAGE_PARAMETER를 반환한다", () => {
      for (const value of [
        "0",
        "101",
        "-1",
        "1.5",
        "01",
        "abc",
        "",
        " ",
        8,
        null,
        [],
        "9007199254740992",
      ]) {
        assert.throws(
          () => validatePagination(undefined, value),
          assertAppError("INVALID_PAGE_PARAMETER", 400),
        );
      }
    });
  });
});
