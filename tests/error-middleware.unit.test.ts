import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import express from "express";

import { ERROR_DEFINITIONS } from "../src/errors/error-definitions.js";
import { errorMiddleware } from "../src/middlewares/error-middleware.js";

describe("공통 에러 미들웨어", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();

    app.use(express.json());

    app.post("/json", (_request, response) => {
      response.sendStatus(200);
    });

    app.get("/syntax-error", () => {
      throw new SyntaxError("Unexpected syntax error");
    });

    app.get("/invalid-error-type", () => {
      throw Object.assign(new SyntaxError("Unexpected syntax error"), {
        type: "unexpected.error",
        status: 400,
      });
    });

    app.get("/invalid-error-status", () => {
      throw Object.assign(new SyntaxError("Unexpected syntax error"), {
        type: "entity.parse.failed",
        status: 500,
      });
    });

    app.get("/non-syntax-error", () => {
      throw Object.assign(new Error("Unexpected error"), {
        type: "entity.parse.failed",
        status: 400,
      });
    });

    app.use(errorMiddleware);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();

    assert.ok(address && typeof address !== "string");

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  // INVALID_REQUEST 오류 코드·메시지와 HTTP 상태 코드 확인
  async function assertInvalidRequest(body: string) {
    const response = await fetch(`${baseUrl}/json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    const definition = ERROR_DEFINITIONS.INVALID_REQUEST;

    assert.equal(response.status, definition.statusCode);
    assert.deepEqual(await response.json(), {
      code: definition.code,
      message: definition.message,
    });
  }

  // INTERNAL_SERVER_ERROR 오류 코드·메시지와 HTTP 상태 코드 확인
  async function assertInternalServerError(path: string) {
    const response = await fetch(`${baseUrl}${path}`);
    const definition = ERROR_DEFINITIONS.INTERNAL_SERVER_ERROR;

    assert.equal(response.status, definition.statusCode);
    assert.deepEqual(await response.json(), {
      code: definition.code,
      message: definition.message,
    });
  }

  describe("JSON 파싱 오류 처리", () => {
    // 잘못된 JSON 문법에 대한 파싱 오류를 INVALID_REQUEST로 변환하는지 확인
    it("잘못된 JSON 문법은 INVALID_REQUEST를 반환한다", async () => {
      await assertInvalidRequest('{"key":}');
    });

    // 최상위 JSON 문자열에 대한 파싱 오류를 INVALID_REQUEST로 변환하는지 확인
    it("최상위 JSON 문자열은 INVALID_REQUEST를 반환한다", async () => {
      await assertInvalidRequest('"text"');
    });

    // 최상위 JSON 숫자에 대한 파싱 오류를 INVALID_REQUEST로 변환하는지 확인
    it("최상위 JSON 숫자는 INVALID_REQUEST를 반환한다", async () => {
      await assertInvalidRequest("123");
    });

    // 최상위 JSON 불리언에 대한 파싱 오류를 INVALID_REQUEST로 변환하는지 확인
    it("최상위 JSON 불리언은 INVALID_REQUEST를 반환한다", async () => {
      await assertInvalidRequest("true");
    });

    // 최상위 JSON null에 대한 파싱 오류를 INVALID_REQUEST로 변환하는지 확인
    it("최상위 JSON null은 INVALID_REQUEST를 반환한다", async () => {
      await assertInvalidRequest("null");
    });
  });

  describe("JSON 파싱 오류 식별 조건", () => {
    // 파싱 오류 식별 정보가 없는 SyntaxError는 서버 내부 오류로 처리하는지 확인
    it("일반 SyntaxError는 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      await assertInternalServerError("/syntax-error");
    });

    // HTTP 상태 코드가 400이어도 오류 타입이 다르면 서버 내부 오류로 처리하는지 확인
    it("파싱 오류 타입이 일치하지 않으면 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      await assertInternalServerError("/invalid-error-type");
    });

    // 오류 타입이 일치해도 HTTP 상태 코드가 400이 아니면 서버 내부 오류로 처리하는지 확인
    it("파싱 오류 상태 코드가 일치하지 않으면 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      await assertInternalServerError("/invalid-error-status");
    });

    // 오류 타입과 HTTP 상태 코드가 일치해도 SyntaxError가 아니면 서버 내부 오류로 처리하는지 확인
    it("SyntaxError가 아니면 INTERNAL_SERVER_ERROR를 반환한다", async () => {
      await assertInternalServerError("/non-syntax-error");
    });
  });
});
