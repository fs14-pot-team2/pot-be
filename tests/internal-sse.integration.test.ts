import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Response } from "express";
import express from "express";

import { env } from "../src/config/env.js";
import { errorMiddleware } from "../src/middlewares/error-middleware.js";
import { internalSseRouter } from "../src/routes/internal-sse-routes.js";
import { addSseClient, removeSseClient } from "../src/services/sse-service.js";

// 실제 DB와 외부 서버 없이 내부 HTTP 라우터만 실행
const app = express();
app.use(express.json());
app.use("/internal/sse", internalSseRouter);
app.use(errorMiddleware);

// 테스트 수신자에게 발행된 SSE 이벤트 수집
function createSseEventCollector(userId: bigint) {
  const events: string[] = [];

  const response = {
    writableEnded: false,
    destroyed: false,
    write(frame: string) {
      events.push(frame);
      return true;
    },
  } as unknown as Response;

  addSseClient(userId, response);

  return { events, response };
}

describe("내부 SSE 이벤트 전파", () => {
  let server: Server;
  let baseUrl: string;
  let originalSecret: string | undefined;

  before(async () => {
    originalSecret = process.env.INTERNAL_SSE_SECRET;
    process.env.INTERNAL_SSE_SECRET = "internal-sse-test-secret";

    server = app.listen(0);
    await once(server, "listening");

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();

    if (originalSecret === undefined) {
      delete process.env.INTERNAL_SSE_SECRET;
    } else {
      process.env.INTERNAL_SSE_SECRET = originalSecret;
    }
  });

  function sendNotification(body: unknown, secret: string | null = env.internalSseSecret) {
    return fetch(`${baseUrl}/internal/sse/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret !== null && { "x-internal-sse-secret": secret }),
      },
      body: JSON.stringify(body),
    });
  }

  describe("인증 및 입력값 검증", () => {
    // 서버 간 인증 헤더가 없으면 이벤트 전파를 차단
    it("공유 비밀키가 없으면 UNAUTHORIZED를 반환한다", async () => {
      const response = await sendNotification({ notificationId: "101", recipientId: "201" }, null);

      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, "UNAUTHORIZED");
    });

    // 잘못된 서버 간 비밀키는 인증 실패 처리
    it("공유 비밀키가 일치하지 않으면 UNAUTHORIZED를 반환한다", async () => {
      const response = await sendNotification(
        { notificationId: "101", recipientId: "201" },
        "incorrect-secret",
      );

      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, "UNAUTHORIZED");
    });

    // 요청 Body가 객체가 아니면 입력 형식 오류 처리
    it("요청 Body 형식이 올바르지 않으면 INVALID_REQUEST를 반환한다", async () => {
      const response = await sendNotification([]);

      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "INVALID_REQUEST");
    });

    // 알림 ID와 수신자 ID는 모두 양의 정수 문자열이어야 함
    it("식별자 형식이 올바르지 않으면 INVALID_ID를 반환한다", async () => {
      for (const body of [
        { notificationId: "invalid", recipientId: "201" },
        { notificationId: "101", recipientId: "invalid" },
        { notificationId: "0", recipientId: "201" },
        { notificationId: "101", recipientId: "-1" },
        { recipientId: "201" },
        { notificationId: "101" },
      ]) {
        const response = await sendNotification(body);

        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_ID");
      }
    });
  });

  describe("SSE 이벤트 발행", () => {
    // 정상 요청은 지정된 수신자에게만 이벤트를 전달
    it("정상 인증 요청은 해당 수신자에게 notification.created 이벤트를 발행하고 204를 반환한다", async (t) => {
      const recipientId = 82001n;
      const otherRecipientId = 82002n;

      const recipient = createSseEventCollector(recipientId);
      const otherRecipient = createSseEventCollector(otherRecipientId);

      t.after(() => {
        removeSseClient(recipientId, recipient.response);
        removeSseClient(otherRecipientId, otherRecipient.response);
      });

      const response = await sendNotification({
        notificationId: "91001",
        recipientId: recipientId.toString(),
      });

      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");

      assert.deepEqual(recipient.events, [
        'event: notification.created\ndata: {"notificationId":"91001"}\n\n',
      ]);
      assert.deepEqual(otherRecipient.events, []);
    });

    // 접속 중인 SSE 클라이언트가 없어도 정상 처리
    it("수신자의 SSE 연결이 없어도 정상 요청은 204를 반환한다", async () => {
      const response = await sendNotification({
        notificationId: "91002",
        recipientId: "82999",
      });

      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
    });
  });
});
