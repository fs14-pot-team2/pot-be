import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import {
  validateServiceRegions,
  validateServiceTypes,
  validateSitterServiceTypes,
} from "../src/validators/profile-validator.js";

describe("프로필 요청 내부 중복값 검증", () => {
  it("팟오너 서비스 유형이 중복되면 INVALID_SERVICE_TYPE이다", () => {
    assert.throws(
      () => validateServiceTypes(["SHORT_CARE", "SHORT_CARE"]),
      new AppError("INVALID_SERVICE_TYPE"),
    );
  });

  it("팟트너 서비스 유형이 중복되면 INVALID_SERVICE_TYPE이다", () => {
    assert.throws(
      () => validateSitterServiceTypes(["SHORT_CARE", "SHORT_CARE"]),
      new AppError("INVALID_SERVICE_TYPE"),
    );
  });

  it("팟트너 서비스 지역이 중복되면 INVALID_REGION이다", () => {
    assert.throws(() => validateServiceRegions(["SEOUL", "SEOUL"]), new AppError("INVALID_REGION"));
  });
});
