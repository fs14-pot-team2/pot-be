import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it, mock } from "node:test";

import express from "express";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../src/config/env.js";
import { connectEventsController } from "../src/controllers/sse-controller.js";
import { errorMiddleware } from "../src/middlewares/error-middleware.js";
import { sseRouter } from "../src/routes/sse-routes.js";
import { getSseConnectionCount, publishToUser } from "../src/services/sse-service.js";
import { signAccessToken } from "../src/utils/jwt.js";

// 전체 app(Prisma 의존)을 올리지 않고 SSE 라우터만 구성
const app = express();
app.use("/events", sseRouter);
app.use(errorMiddleware);

const decoder = new TextDecoder();

// 조건이 만족될 때까지 잠깐씩 기다린다
async function waitFor(condition: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 시간 초과");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// 스트림에서 원하는 문자열이 나올 때까지 읽는다
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
  timeoutMs = 2_000,
) {
  let received = "";
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`"${expected}" 수신 시간 초과`)), timeoutMs);
  });
  const read = (async () => {
    while (!received.includes(expected)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("스트림이 먼저 종료됨");
      received += decoder.decode(value);
    }
    return received;
  })();
  // 타임아웃 뒤 abort()로 read가 거부돼도 처리되지 않은 rejection이 되지 않게 한다.
  read.catch(() => {});
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe("GET /events (HTTP)", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = app.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const connect = (token?: string, signal?: AbortSignal) =>
    fetch(`${baseUrl}/events`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
    });

  // 기준 1, 5: 인증 없는 요청 차단
  it("토큰이 없으면 UNAUTHORIZED로 거부한다", async () => {
    const response = await connect();
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  });

  it("잘못된 토큰이면 UNAUTHORIZED로 거부한다", async () => {
    const response = await connect("not-a-valid-token");
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  });

  it("만료된 토큰이면 TOKEN_EXPIRED로 거부한다", async () => {
    const expired = jwt.sign({ sub: "1", role: "OWNER" }, env.jwtAccessSecret, {
      algorithm: "HS256",
      expiresIn: -10,
    });
    const response = await connect(expired);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "TOKEN_EXPIRED");
  });

  // 기준 1, 5: 정상 연결
  it("정상 토큰이면 event-stream으로 연결된다", async () => {
    const controller = new AbortController();
    try {
      const token = signAccessToken({ sub: "101", role: "OWNER" });

      const response = await connect(token, controller.signal);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
      assert.equal(response.headers.get("x-accel-buffering"), "no");

      const reader = response.body!.getReader();
      await readUntil(reader, ": connected");
      assert.equal(getSseConnectionCount(), 1);
    } finally {
      controller.abort();
      await waitFor(() => getSseConnectionCount() === 0);
    }
  });

  // 기준 5: 연결 종료 시 정리
  it("클라이언트가 연결을 끊으면 등록된 연결이 정리된다", async () => {
    const controller = new AbortController();
    try {
      const response = await connect(
        signAccessToken({ sub: "102", role: "SITTER" }),
        controller.signal,
      );
      await readUntil(response.body!.getReader(), ": connected");
      assert.equal(getSseConnectionCount(), 1);
    } finally {
      controller.abort();
      await waitFor(() => getSseConnectionCount() === 0);
    }
  });

  // 기준 5: 해당 사용자만 이벤트 수신
  it("발행한 사용자의 연결만 이벤트를 받는다", async () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    try {
      const responseA = await connect(
        signAccessToken({ sub: "201", role: "OWNER" }),
        controllerA.signal,
      );
      const responseB = await connect(
        signAccessToken({ sub: "202", role: "SITTER" }),
        controllerB.signal,
      );
      const readerA = responseA.body!.getReader();
      const readerB = responseB.body!.getReader();
      await readUntil(readerA, ": connected");
      await readUntil(readerB, ": connected");

      publishToUser(201n, "message.created", {
        conversationId: "45",
        messageId: "678",
        senderId: "202",
      });

      const received = await readUntil(readerA, "event: message.created");
      assert.ok(
        received.includes('data: {"conversationId":"45","messageId":"678","senderId":"202"}'),
      );

      // 다른 사용자는 짧은 시간 안에 아무것도 받지 않아야 한다
      await assert.rejects(readUntil(readerB, "message.created", 300), /수신 시간 초과/);
    } finally {
      controllerA.abort();
      controllerB.abort();
      await waitFor(() => getSseConnectionCount() === 0);
    }
  });

  // 기준 4: 토큰 만료 시 서버가 연결 종료 (실제 타이머, 약 2초 소요)
  it("액세스 토큰이 만료되면 서버가 스트림을 종료한다", async () => {
    const controller = new AbortController();
    try {
      const shortLived = jwt.sign({ sub: "301", role: "OWNER" }, env.jwtAccessSecret, {
        algorithm: "HS256",
        expiresIn: 2,
      });
      const response = await connect(shortLived, controller.signal);
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();

      const ended = (async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) return true;
        }
      })();
      ended.catch(() => {});
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000));

      assert.equal(await Promise.race([ended, timeout]), true);
    } finally {
      controller.abort();
      await waitFor(() => getSseConnectionCount() === 0);
    }
  });
});

// 기준 4: heartbeat와 만료 종료를 가짜 타이머로 검증 (HTTP 없이 컨트롤러 직접 호출)
describe("connectEventsController 타이머", () => {
  function createFakeConnection(token: string, options: { failPing?: boolean } = {}) {
    const listeners = new Map<string, Array<() => void>>();
    const written: string[] = [];
    let ended = false;

    const on = (event: string, handler: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    };

    const request = {
      headers: { authorization: `Bearer ${token}` },
      user: { id: 401n, role: "OWNER" },
      on,
    } as unknown as Request;

    const response = {
      get writableEnded() {
        return ended;
      },
      destroyed: false,
      set() {
        return this;
      },
      flushHeaders() {},
      write(chunk: string) {
        if (options.failPing && chunk === ": ping\n\n") throw new Error("write failed");
        written.push(chunk);
        return true;
      },
      end() {
        ended = true;
      },
      on,
    } as unknown as Response;

    return {
      request,
      response,
      written,
      isEnded: () => ended,
      emit: (event: string) => listeners.get(event)?.forEach((fn) => fn()),
    };
  }

  it("25초마다 heartbeat를 보내고, 연결이 끊기면 멈춘다", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: Date.now() });
    try {
      const token = jwt.sign({ sub: "401", role: "OWNER" }, env.jwtAccessSecret, {
        expiresIn: 600,
      });
      const connection = createFakeConnection(token);

      connectEventsController(connection.request, connection.response, () => {});
      const initialWrites = connection.written.length;

      mock.timers.tick(25_000);
      assert.equal(connection.written.length, initialWrites + 1);
      assert.equal(connection.written.at(-1), ": ping\n\n");

      mock.timers.tick(25_000);
      assert.equal(connection.written.length, initialWrites + 2);

      connection.emit("close");
      mock.timers.tick(50_000);
      assert.equal(connection.written.length, initialWrites + 2);
      assert.equal(getSseConnectionCount(), 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("heartbeat 전송이 실패하면 예외 없이 연결을 정리한다", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: Date.now() });
    try {
      const token = jwt.sign({ sub: "401", role: "OWNER" }, env.jwtAccessSecret, {
        expiresIn: 600,
      });
      const connection = createFakeConnection(token, { failPing: true });

      connectEventsController(connection.request, connection.response, () => {});
      assert.equal(getSseConnectionCount(), 1);

      assert.doesNotThrow(() => mock.timers.tick(25_000));
      assert.equal(getSseConnectionCount(), 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("토큰 만료 시각이 되면 연결을 end()하고 정리한다", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: Date.now() });
    try {
      const token = jwt.sign({ sub: "401", role: "OWNER" }, env.jwtAccessSecret, {
        expiresIn: 60,
      });
      const connection = createFakeConnection(token);

      connectEventsController(connection.request, connection.response, () => {});
      assert.equal(getSseConnectionCount(), 1);

      mock.timers.tick(59_000);
      assert.equal(connection.isEnded(), false);

      mock.timers.tick(2_000);
      assert.equal(connection.isEnded(), true);
      assert.equal(getSseConnectionCount(), 0);
    } finally {
      mock.timers.reset();
    }
  });
});
