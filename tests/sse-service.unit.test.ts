import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { Response } from "express";

import {
  addSseClient,
  getSseConnectionCount,
  publishToUser,
  removeSseClient,
} from "../src/services/sse-service.js";

interface FakeResponseOptions {
  failOnWrite?: boolean;
  ended?: boolean;
  destroyed?: boolean;
}

// write 호출 내용만 기록하는 가짜 응답
function createFakeResponse(options: FakeResponseOptions = {}) {
  const frames: string[] = [];
  const response = {
    writableEnded: options.ended ?? false,
    destroyed: options.destroyed ?? false,
    write(chunk: string) {
      if (options.failOnWrite) throw new Error("write failed");
      frames.push(chunk);
      return true;
    },
  } as unknown as Response;
  return { response, frames };
}

describe("SSE 연결 관리", () => {
  const connected: Array<{ userId: bigint; response: Response }> = [];

  function connect(userId: bigint, response: Response) {
    addSseClient(userId, response);
    connected.push({ userId, response });
  }

  // 테스트 간 연결 상태가 섞이지 않도록 모든 연결을 정리
  beforeEach(() => {
    for (const { userId, response } of connected.splice(0)) {
      removeSseClient(userId, response);
    }
  });

  // 이벤트 형식과 수신자 한정 전송 확인
  it("대상 사용자의 연결에만 이벤트를 전달한다", () => {
    const target = createFakeResponse();
    const other = createFakeResponse();
    connect(1n, target.response);
    connect(2n, other.response);

    publishToUser(1n, "notification.created", { notificationId: "10" });

    assert.deepEqual(target.frames, [
      'event: notification.created\ndata: {"notificationId":"10"}\n\n',
    ]);
    assert.deepEqual(other.frames, []);
  });

  // 같은 사용자가 여러 탭으로 접속한 경우
  it("같은 사용자의 모든 탭에 이벤트를 전달한다", () => {
    const tabA = createFakeResponse();
    const tabB = createFakeResponse();
    connect(1n, tabA.response);
    connect(1n, tabB.response);

    publishToUser(1n, "message.created", {
      conversationId: "45",
      messageId: "678",
      senderId: "12",
    });

    assert.equal(tabA.frames.length, 1);
    assert.equal(tabB.frames.length, 1);
  });

  // 연결 종료 후 전송 대상에서 빠지는지 확인
  it("연결이 해제되면 더 이상 이벤트를 받지 않는다", () => {
    const tab = createFakeResponse();
    addSseClient(1n, tab.response);
    removeSseClient(1n, tab.response);

    publishToUser(1n, "notification.created", { notificationId: "10" });

    assert.deepEqual(tab.frames, []);
    assert.equal(getSseConnectionCount(), 0);
  });

  // 연결이 없는 사용자에게 발행해도 오류 없이 지나가는지 확인
  it("연결이 없는 사용자에게 발행해도 오류가 나지 않는다", () => {
    assert.doesNotThrow(() => {
      publishToUser(999n, "notification.created", { notificationId: "1" });
    });
  });

  // 한 연결의 전송 실패가 다른 연결이나 호출한 API에 번지지 않는지 확인
  it("한 연결의 전송이 실패해도 다른 연결에는 전달한다", () => {
    const broken = createFakeResponse({ failOnWrite: true });
    const healthy = createFakeResponse();
    connect(1n, broken.response);
    connect(1n, healthy.response);

    assert.doesNotThrow(() => {
      publishToUser(1n, "notification.created", { notificationId: "10" });
    });
    assert.equal(healthy.frames.length, 1);
    assert.equal(getSseConnectionCount(), 1); // 깨진 연결은 제거됨
  });

  // 전송에 실패한 연결만 남아 있던 사용자의 키도 정리되는지 확인
  it("전송이 실패한 연결만 있으면 사용자 항목까지 정리한다", () => {
    const broken = createFakeResponse({ failOnWrite: true });
    connect(1n, broken.response);

    assert.doesNotThrow(() => {
      publishToUser(1n, "notification.created", { notificationId: "10" });
    });
    assert.equal(getSseConnectionCount(), 0);
  });

  // JSON 직렬화가 실패해도 호출한 API에 예외가 번지지 않는지 확인 (BigInt는 직렬화 불가)
  it("직렬화에 실패해도 예외를 던지지 않고 아무것도 전송하지 않는다", () => {
    const tab = createFakeResponse();
    connect(1n, tab.response);

    assert.doesNotThrow(() => {
      publishToUser(1n, "notification.created", {
        notificationId: 10n as unknown as string,
      });
    });
    assert.deepEqual(tab.frames, []);
    assert.equal(getSseConnectionCount(), 1);
  });

  // 만료로 end()된 연결, 끊어진 연결에 쓰면 처리되지 않는 오류가 날 수 있어 쓰지 않아야 한다
  for (const [label, options] of [
    ["이미 종료된(end) 연결", { ended: true }],
    ["끊어진(destroyed) 연결", { destroyed: true }],
  ] as const) {
    it(`${label}에는 쓰지 않고 목록에서 제거한다`, () => {
      const closed = createFakeResponse(options);
      connect(1n, closed.response);

      publishToUser(1n, "notification.created", { notificationId: "10" });

      assert.deepEqual(closed.frames, []);
      assert.equal(getSseConnectionCount(), 0);
    });
  }

  // 닫힌 연결이 섞여 있어도 같은 사용자의 정상 연결에는 전달되는지 확인
  it("종료된 연결이 있어도 정상 연결에는 전달한다", () => {
    const closed = createFakeResponse({ ended: true });
    const healthy = createFakeResponse();
    connect(1n, closed.response);
    connect(1n, healthy.response);

    publishToUser(1n, "notification.created", { notificationId: "10" });

    assert.deepEqual(closed.frames, []);
    assert.equal(healthy.frames.length, 1);
    assert.equal(getSseConnectionCount(), 1);
  });

  // close·error·만료에서 정리가 겹쳐 불려도 문제없는지 확인
  it("같은 연결을 두 번 제거해도 오류가 나지 않는다", () => {
    const tab = createFakeResponse();
    addSseClient(1n, tab.response);

    assert.doesNotThrow(() => {
      removeSseClient(1n, tab.response);
      removeSseClient(1n, tab.response);
    });
    assert.equal(getSseConnectionCount(), 0);
  });
});
