import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validateCreateDesignatedRequest } from "../src/validators/designated-request-validator.js";

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("지정 요청 생성 입력값 검증", () => {
  describe("요청 본문 검증", () => {
    // 객체가 아닌 요청 본문에 대한 오류 반환 확인
    it("잘못된 요청 본문은 INVALID_REQUEST를 반환한다", () => {
      for (const body of [undefined, null, [], "", 1, true]) {
        assert.throws(
          () => validateCreateDesignatedRequest(body),
          assertAppError("INVALID_REQUEST"),
        );
      }
    });

    // 필수 ID가 누락된 요청에 대한 오류 반환 확인
    it("sitterId가 누락되면 INVALID_REQUEST를 반환한다", () => {
      assert.throws(() => validateCreateDesignatedRequest({}), assertAppError("INVALID_REQUEST"));
    });
  });

  describe("ID 유효성 검증", () => {
    // 문자열이 아닌 ID에 대한 오류 반환 확인
    it("문자열이 아닌 sitterId는 INVALID_ID를 반환한다", () => {
      for (const sitterId of [null, 20, true, [], {}]) {
        assert.throws(
          () => validateCreateDesignatedRequest({ sitterId }),
          assertAppError("INVALID_ID"),
        );
      }
    });

    // 양의 정수 문자열 형식에 맞지 않는 ID 차단 확인
    it("형식이 올바르지 않은 sitterId는 INVALID_ID를 반환한다", () => {
      for (const sitterId of ["", " ", " 20 ", "0", "-1", "1.5", "01", "abc"]) {
        assert.throws(
          () => validateCreateDesignatedRequest({ sitterId }),
          assertAppError("INVALID_ID"),
        );
      }
    });

    // PostgreSQL BigInt 허용 범위를 초과한 ID 차단 확인
    it("허용 범위를 초과한 sitterId는 INVALID_ID를 반환한다", () => {
      assert.throws(
        () =>
          validateCreateDesignatedRequest({
            sitterId: "9223372036854775808",
          }),
        assertAppError("INVALID_ID"),
      );
    });

    // 유효한 ID와 허용 범위 경계값의 BigInt 변환 확인
    it("유효한 sitterId를 bigint로 변환하여 반환한다", () => {
      assert.equal(validateCreateDesignatedRequest({ sitterId: "1" }), 1n);
      assert.equal(validateCreateDesignatedRequest({ sitterId: "20" }), 20n);
      assert.equal(
        validateCreateDesignatedRequest({
          sitterId: "9223372036854775807",
        }),
        9223372036854775807n,
      );
    });
  });
});
