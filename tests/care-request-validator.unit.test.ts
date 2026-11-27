import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validateReceivedCareRequestsQuery } from "../src/validators/care-request-validator.js";

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("돌봄 요청 입력값 검증", () => {
  describe("받은 요청 검색어 검증", () => {
    // NUL 문자 단독 및 위치별 포함 시 오류 반환 확인
    it("NUL 문자가 포함된 검색어는 INVALID_REQUEST를 반환한다", () => {
      for (const keyword of ["\0", "\0초록", "초\0록", "초록\0"]) {
        assert.throws(
          () => validateReceivedCareRequestsQuery({ keyword }),
          assertAppError("INVALID_REQUEST", 400),
        );
      }
    });

    // 정상 검색어의 앞뒤 공백 제거 확인
    it("정상 검색어는 앞뒤 공백을 제거해 반환한다", () => {
      assert.equal(validateReceivedCareRequestsQuery({ keyword: " 초록 " }).keyword, "초록");
    });

    // 검색어 미입력 및 공백 입력 시 기존 반환값 유지 확인
    it("검색어를 생략하거나 공백만 입력하면 빈 문자열을 반환한다", () => {
      assert.equal(validateReceivedCareRequestsQuery({}).keyword, "");
      assert.equal(validateReceivedCareRequestsQuery({ keyword: "  " }).keyword, "");
    });
  });
});
