import assert from "node:assert/strict";
import { describe, it } from "node:test";

import AppError from "../src/errors/app-error.js";
import { validateSendMessageBody } from "../src/validators/message-validator.js";

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

describe("쪽지 발송 요청 검증", () => {
  const body = (content: unknown) => ({ otherUserId: "20", content });

  it("공백 제외 1자 이상이면 허용한다", () => {
    assert.equal(validateSendMessageBody(body("a")).content, "a");
  });

  it("공백이 섞여도 공백 제외 1자 이상이면 허용하고 원문을 유지한다", () => {
    assert.equal(validateSendMessageBody(body("  안  ")).content, "  안  ");
  });

  it("빈 문자열과 공백만 있는 내용은 INVALID_MESSAGE_CONTENT다", () => {
    assert.throws(() => validateSendMessageBody(body("")), isAppError("INVALID_MESSAGE_CONTENT"));
    assert.throws(
      () => validateSendMessageBody(body(" \n\t ")),
      isAppError("INVALID_MESSAGE_CONTENT"),
    );
  });

  it("문자열이 아니면 INVALID_MESSAGE_CONTENT다", () => {
    assert.throws(() => validateSendMessageBody(body(1)), isAppError("INVALID_MESSAGE_CONTENT"));
  });

  it("공백 제외 1000자는 허용하고 1001자는 거부한다", () => {
    assert.doesNotThrow(() => validateSendMessageBody(body("a".repeat(1000))));
    assert.throws(
      () => validateSendMessageBody(body("a".repeat(1001))),
      isAppError("INVALID_MESSAGE_CONTENT"),
    );
  });
});
