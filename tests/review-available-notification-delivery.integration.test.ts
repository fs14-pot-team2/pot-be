import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { after, before, describe, it, type TestContext } from "node:test";

import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { deliverReviewAvailableNotificationWithRetry } from "../src/services/review-available-notification-delivery-service.js";
import { sendInternalSseNotification } from "../src/services/internal-sse-http-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

type HttpScenario =
  | { statusCode: number; beforeResponse?: () => Promise<void> }
  | { error: Error }
  | { timeout: true };

type RecordedRequest = {
  options: RequestOptions;
  body: string;
};

// 실제 DB에 독립적인 알림 및 리뷰 작성 가능 요청 생성
async function createTestNotification(options: { readAt?: Date | null } = {}) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `review-delivery-owner-${uniqueId}@example.com`,
      nickname: `review-delivery-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `review-delivery-sitter-${uniqueId}@example.com`,
      nickname: `review-delivery-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
      sitterProfile: {
        create: {
          gender: "FEMALE",
          shortIntroduction: "테스트용 팟트너",
        },
      },
    },
  });

  const endDate = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);

  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 3);

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate,
      endDate,
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "MATCHED",
    },
  });

  const quote = await prisma.quote.create({
    data: {
      careRequestId: careRequest.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 50000,
      comment: "테스트 견적 코멘트입니다.",
    },
  });

  await prisma.careRequest.update({
    where: { id: careRequest.id },
    data: { confirmedQuoteId: quote.id },
  });

  const savedNotification = await prisma.notification.create({
    data: {
      recipientId: owner.id,
      careRequestId: careRequest.id,
      type: "REVIEW_AVAILABLE",
      message: `${sitter.nickname} 팟트너에게 리뷰를 작성해 주세요!`,
      readAt: options.readAt ?? null,
    },
  });

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: careRequest.id,
    notification: {
      id: savedNotification.id,
      recipientId: savedNotification.recipientId,
      careRequestId: careRequest.id,
    },
  };
}

// 실제 DB에 작성된 리뷰 또는 소프트 삭제된 리뷰 저장
async function createTestReview(
  fixture: Awaited<ReturnType<typeof createTestNotification>>,
  deleted = false,
) {
  return prisma.review.create({
    data: {
      careRequestId: fixture.careRequestId,
      ownerId: fixture.ownerId,
      sitterId: fixture.sitterId,
      rating: 5,
      content: "정말 친절하셨어요.",
      deletedAt: deleted ? new Date() : null,
    },
  });
}

// 운영 HTTPS 함수를 변경하지 않고 테스트 범위에서만 응답 및 오류 재현
function mockHttpsRequests(t: TestContext, scenarios: HttpScenario[]) {
  const requests: RecordedRequest[] = [];
  let scenarioIndex = 0;

  const requestMock = t.mock.method(https, "request", ((
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => {
    const scenario = scenarios[scenarioIndex++];

    assert.ok(scenario, "예상하지 않은 추가 HTTPS 요청입니다.");

    const client = new EventEmitter() as EventEmitter & {
      end: (body: string) => void;
      destroy: (error?: Error) => void;
    };

    client.destroy = (error?: Error) => {
      if (error) {
        queueMicrotask(() => client.emit("error", error));
      }
    };

    client.end = (body: string) => {
      requests.push({ options, body });

      queueMicrotask(async () => {
        try {
          if ("error" in scenario) {
            client.emit("error", scenario.error);
            return;
          }

          if ("timeout" in scenario) {
            client.emit("timeout");
            return;
          }

          await scenario.beforeResponse?.();

          const response = new EventEmitter() as EventEmitter & {
            statusCode: number;
            resume: () => void;
          };

          response.statusCode = scenario.statusCode;
          response.resume = () => {};

          onResponse(response as unknown as IncomingMessage);
          response.emit("end");
        } catch (error) {
          client.emit("error", error);
        }
      });
    };

    return client as unknown as ClientRequest;
  }) as typeof https.request);

  // 내장 모듈의 ESM named export에도 테스트용 request 함수를 반영
  syncBuiltinESMExports();

  t.after(() => {
    requestMock.mock.restore();
    syncBuiltinESMExports();
  });

  return requests;
}

// 전송 전후 DB 알림의 저장값과 읽음 상태가 변경되지 않았는지 확인
async function assertNotificationUnchanged(notificationId: bigint, expectedReadAt: Date | null) {
  const savedNotification = await prisma.notification.findUniqueOrThrow({
    where: { id: notificationId },
  });

  assert.equal(savedNotification.type, "REVIEW_AVAILABLE");
  assert.deepEqual(savedNotification.readAt, expectedReadAt);

  assert.equal(
    await prisma.notification.count({
      where: { id: notificationId },
    }),
    1,
  );
}

describe("리뷰 작성 가능 알림 SSE 전달", () => {
  let originalSecret: string | undefined;
  let originalEbIp: string | undefined;

  before(() => {
    originalSecret = process.env.INTERNAL_SSE_SECRET;
    originalEbIp = process.env.INTERNAL_SSE_EB_PRIVATE_IP;

    process.env.INTERNAL_SSE_SECRET = "review-delivery-test-secret";
    process.env.INTERNAL_SSE_EB_PRIVATE_IP = "127.0.0.1";
  });

  after(() => {
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_SSE_SECRET;
    } else {
      process.env.INTERNAL_SSE_SECRET = originalSecret;
    }

    if (originalEbIp === undefined) {
      delete process.env.INTERNAL_SSE_EB_PRIVATE_IP;
    } else {
      process.env.INTERNAL_SSE_EB_PRIVATE_IP = originalEbIp;
    }
  });

  describe("HTTPS 요청 및 재시도", () => {
    // 실제 HTTPS Service가 문자열 ID와 인증 헤더를 올바르게 구성하는지 확인
    it("HTTPS 요청에 알림 ID와 수신자 ID를 문자열로 전달한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      const statusCode = await sendInternalSseNotification(
        fixture.notification.id,
        fixture.notification.recipientId,
      );

      assert.equal(statusCode, 204);
      assert.equal(requests.length, 1);

      const request = requests[0];

      assert.equal(request.options.hostname, env.internalSseEbPrivateIp);
      assert.equal(request.options.port, 443);
      assert.equal(request.options.method, "POST");
      assert.equal(request.options.path, "/internal/sse/notifications");
      assert.equal(request.options.servername, "pot-api.duckdns.org");

      const headers = request.options.headers as Record<string, string | number>;

      assert.equal(headers["Host"], "pot-api.duckdns.org");
      assert.equal(headers["x-internal-sse-secret"], env.internalSseSecret);
      assert.equal(headers["Content-Type"], "application/json");
      assert.equal(headers["Content-Length"], Buffer.byteLength(request.body));

      assert.deepEqual(JSON.parse(request.body), {
        notificationId: fixture.notification.id.toString(),
        recipientId: fixture.notification.recipientId.toString(),
      });
    });

    // 최초 요청 성공 시 추가 HTTP 전송이나 재시도가 발생하지 않는지 확인
    it("최초 HTTP 응답이 204이면 추가 전송 없이 종료한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 전송은 생성 시점 검증 결과를 사용하므로 리뷰를 다시 조회하지 않음
    it("최초 전송은 리뷰 작성 이력이 있어도 재조회하지 않는다", async (t) => {
      const fixture = await createTestNotification();
      await createTestReview(fixture);

      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 비정상 응답 후 재시도에 성공하면 더 이상 HTTP 요청을 보내지 않음
    it("비정상 HTTP 응답 후 204를 받으면 재시도를 중단한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 500 }, { statusCode: 204 }]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 2);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 비정상 HTTP 응답이 계속되면 최대 세 번 전송 후 실패 기록
    it("비정상 HTTP 응답이 계속되면 최대 3회 전송 후 실패를 기록한다", async (t) => {
      const readAt = new Date();
      const fixture = await createTestNotification({ readAt });
      const requests = mockHttpsRequests(t, [
        { statusCode: 500 },
        { statusCode: 502 },
        { statusCode: 503 },
      ]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.deepEqual(errors, [
        [
          "리뷰 작성 가능 알림 SSE 전송 최종 실패",
          {
            notificationId: fixture.notification.id.toString(),
            statusCode: 503,
            sendCount: 3,
          },
        ],
      ]);

      await assertNotificationUnchanged(fixture.notification.id, readAt);
    });

    // 네트워크 연결 실패도 최대 세 번 재시도하고 기존 알림을 유지
    it("네트워크 오류가 계속되면 최대 3회 전송 후 기존 알림을 유지한다", async (t) => {
      const fixture = await createTestNotification();
      const networkError = new Error("ECONNREFUSED");
      const requests = mockHttpsRequests(t, [
        { error: networkError },
        { error: networkError },
        { error: networkError },
      ]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.deepEqual(errors, [
        [
          "리뷰 작성 가능 알림 SSE 전송 최종 실패",
          {
            notificationId: fixture.notification.id.toString(),
            sendCount: 3,
            error: networkError,
          },
        ],
      ]);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // HTTPS 요청의 timeout 이벤트 발생 시에도 최대 세 번 전송
    it("HTTP 타임아웃이 계속되면 최대 3회 전송 후 실패를 기록한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [
        { timeout: true },
        { timeout: true },
        { timeout: true },
      ]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "리뷰 작성 가능 알림 SSE 전송 최종 실패");
      assert.deepEqual(errors[0][1], {
        notificationId: fixture.notification.id.toString(),
        sendCount: 3,
        error: new Error("Internal SSE HTTP request timed out"),
      });

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 여러 실패 유형이 섞여도 전송 횟수 제한과 성공 중단 조건 유지
    it("HTTP 오류와 네트워크 오류가 혼합되어도 최대 3회만 전송한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [
        { statusCode: 503 },
        { error: new Error("ECONNRESET") },
        { statusCode: 204 },
      ]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });
  });

  describe("리뷰 작성 및 삭제 이력", () => {
    // 최초 전송 실패 후 리뷰 작성 시 다음 전송을 중단
    it("재시도 전에 리뷰가 작성되면 추가 전송을 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            await createTestReview(fixture);
          },
        },
      ]);

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      assert.equal(
        await prisma.review.count({
          where: { careRequestId: fixture.careRequestId },
        }),
        1,
      );

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 소프트 삭제된 리뷰도 재시도 중단 조건에 포함
    it("재시도 전에 삭제된 리뷰 이력이 있으면 추가 전송을 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            await createTestReview(fixture, true);
          },
        },
      ]);

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);

      const review = await prisma.review.findUniqueOrThrow({
        where: { careRequestId: fixture.careRequestId },
      });

      assert.ok(review.deletedAt instanceof Date);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 두 번째 전송 이후 리뷰가 작성되면 세 번째 HTTP 요청을 보내지 않음
    it("두 번째 전송 후 리뷰가 작성되면 마지막 재시도를 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        { statusCode: 500 },
        {
          statusCode: 503,
          beforeResponse: async () => {
            await createTestReview(fixture);
          },
        },
      ]);

      await deliverReviewAvailableNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 2);

      assert.equal(
        await prisma.review.count({
          where: { careRequestId: fixture.careRequestId },
        }),
        1,
      );

      await assertNotificationUnchanged(fixture.notification.id, null);
    });
  });
});
