import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { after, before, describe, it, type TestContext } from "node:test";

import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { expirePastCareRequests } from "../src/services/care-request-expiration.js";
import { deliverCareRequestExpiredNotificationWithRetry } from "../src/services/care-request-notification-delivery-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

type HttpScenario =
  | { statusCode: number; beforeResponse?: () => Promise<void> }
  | { error: Error }
  | { timeout: true };

type RecordedRequest = {
  options: RequestOptions;
  body: string;
};

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 실제 DB에 독립적인 만료 요청, 견적 및 팟트너 알림 생성
async function createTestNotification(
  options: {
    readAt?: Date | null;
  } = {},
) {
  const { readAt = null } = options;
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `care-expired-delivery-owner-${uniqueId}@example.com`,
      nickname: `care-expired-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `care-expired-delivery-sitter-${uniqueId}@example.com`,
      nickname: `care-expired-sitter-${uniqueId}`,
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

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: dateOffset(-1),
      endDate: dateOffset(2),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "EXPIRED",
    },
  });

  await prisma.quote.create({
    data: {
      careRequestId: careRequest.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 50000,
      comment: "테스트 견적 코멘트입니다.",
    },
  });

  const savedNotification = await prisma.notification.create({
    data: {
      recipientId: sitter.id,
      careRequestId: careRequest.id,
      type: "CARE_REQUEST_EXPIRED",
      message: `${owner.nickname} 팟오너의 요청이 만료 되었어요.`,
      readAt,
    },
  });

  return {
    sitterId: sitter.id,
    careRequestId: careRequest.id,
    notification: {
      id: savedNotification.id,
      recipientId: savedNotification.recipientId,
      careRequestId: careRequest.id,
    },
  };
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

// SSE 전송 전후 기존 DB 알림의 저장값과 읽음 상태 유지 확인
async function assertNotificationUnchanged(notificationId: bigint, expectedReadAt: Date | null) {
  const savedNotification = await prisma.notification.findUniqueOrThrow({
    where: { id: notificationId },
  });

  assert.equal(savedNotification.type, "CARE_REQUEST_EXPIRED");
  assert.deepEqual(savedNotification.readAt, expectedReadAt);

  assert.equal(
    await prisma.notification.count({
      where: { id: notificationId },
    }),
    1,
  );
}

describe("돌봄 요청 만료 알림 SSE 전달", () => {
  let originalSecret: string | undefined;
  let originalEbIp: string | undefined;

  before(() => {
    originalSecret = process.env.INTERNAL_SSE_SECRET;
    originalEbIp = process.env.INTERNAL_SSE_EB_PRIVATE_IP;

    process.env.INTERNAL_SSE_SECRET = "care-expired-delivery-test-secret";
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
    // 기존 HTTPS 인증·연결 설정 및 알림 식별자 문자열 변환 확인
    it("HTTPS 요청에 알림 ID와 수신자 ID를 문자열로 전달한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

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
        recipientId: fixture.sitterId.toString(),
      });

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 요청 성공 시 추가 전송 없이 종료
    it("최초 HTTP 응답이 204이면 추가 전송 없이 종료한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 비정상 HTTP 응답 이후 성공하면 추가 재시도 중단
    it("비정상 HTTP 응답 후 204를 받으면 재시도를 중단한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 500 }, { statusCode: 204 }]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 2);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 비정상 HTTP 응답이 계속되면 세 번 전송 후 실패 기록
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

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "돌봄 요청 만료 알림 SSE 전송 최종 실패");

      const failureDetails = errors[0][1] as Record<string, unknown>;

      assert.equal(failureDetails.notificationId, fixture.notification.id.toString());
      assert.equal(failureDetails.statusCode, 503);
      assert.equal(failureDetails.sendCount, 3);

      await assertNotificationUnchanged(fixture.notification.id, readAt);
    });

    // 네트워크 오류도 최대 세 번 재시도하고 기존 DB 알림 유지
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

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "돌봄 요청 만료 알림 SSE 전송 최종 실패");

      const failureDetails = errors[0][1] as Record<string, unknown>;

      assert.equal(failureDetails.notificationId, fixture.notification.id.toString());
      assert.equal(failureDetails.sendCount, 3);
      assert.equal(failureDetails.error, networkError);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // HTTP 타임아웃도 최대 세 번 재시도하고 기존 DB 알림 유지
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

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "돌봄 요청 만료 알림 SSE 전송 최종 실패");

      const failureDetails = errors[0][1] as Record<string, unknown>;

      assert.equal(failureDetails.notificationId, fixture.notification.id.toString());
      assert.equal(failureDetails.sendCount, 3);
      assert.deepEqual(failureDetails.error, new Error("Internal SSE HTTP request timed out"));

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 실패 유형이 혼합되어도 전송 횟수 제한과 성공 중단 조건 유지
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

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 신규 생성 알림만 SSE 전송하고 반복 실행에서는 기존 알림 제외
    it("반복 실행 시 이미 생성된 알림의 SSE 이벤트를 재전송하지 않는다", async (t) => {
      const fixture = await createTestNotification();

      await prisma.notification.delete({
        where: { id: fixture.notification.id },
      });

      const firstResult = await expirePastCareRequests();
      const createdNotifications = firstResult.notifications.filter(
        (notification) => notification.careRequestId === fixture.careRequestId,
      );

      assert.equal(createdNotifications.length, 1);

      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      for (const notification of createdNotifications) {
        await deliverCareRequestExpiredNotificationWithRetry(notification);
      }

      assert.equal(requests.length, 1);

      assert.deepEqual(JSON.parse(requests[0].body), {
        notificationId: createdNotifications[0].id.toString(),
        recipientId: fixture.sitterId.toString(),
      });

      const secondResult = await expirePastCareRequests();
      const repeatedNotifications = secondResult.notifications.filter(
        (notification) => notification.careRequestId === fixture.careRequestId,
      );

      assert.equal(repeatedNotifications.length, 0);

      for (const notification of repeatedNotifications) {
        await deliverCareRequestExpiredNotificationWithRetry(notification);
      }

      assert.equal(requests.length, 1);

      const savedNotifications = await prisma.notification.findMany({
        where: {
          careRequestId: fixture.careRequestId,
          type: "CARE_REQUEST_EXPIRED",
        },
      });

      assert.equal(savedNotifications.length, 1);
      assert.equal(savedNotifications[0].id, createdNotifications[0].id);
      assert.equal(savedNotifications[0].readAt, null);
    });
  });

  describe("돌봄 요청 상태", () => {
    // 최초 전송은 생성 시 검증된 상태를 사용하고 DB 재조회 생략
    it("최초 전송은 돌봄 요청 상태를 재조회하지 않는다", async (t) => {
      const fixture = await createTestNotification();

      await prisma.careRequest.update({
        where: { id: fixture.careRequestId },
        data: { status: "OPEN" },
      });

      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 전송 실패 이후에도 만료 상태라면 재시도 진행
    it("재시도 전에 요청이 EXPIRED 상태이면 추가 전송한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 500 }, { statusCode: 204 }]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 2);

      for (const request of requests) {
        assert.deepEqual(JSON.parse(request.body), {
          notificationId: fixture.notification.id.toString(),
          recipientId: fixture.sitterId.toString(),
        });
      }

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 전송 실패 후 요청이 사라지면 재시도 중단
    it("재시도 전에 돌봄 요청이 존재하지 않으면 추가 전송을 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            // 외래 키 제약에 따라 연결 데이터부터 제거
            await prisma.notification.delete({
              where: { id: fixture.notification.id },
            });

            await prisma.quote.deleteMany({
              where: { careRequestId: fixture.careRequestId },
            });

            await prisma.careRequest.delete({
              where: { id: fixture.careRequestId },
            });
          },
        },
      ]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);

      assert.equal(
        await prisma.careRequest.count({
          where: { id: fixture.careRequestId },
        }),
        0,
      );
    });

    // 최초 전송 실패 후 요청 상태가 불일치하면 재시도 중단
    it("재시도 전에 요청 상태가 EXPIRED가 아니면 추가 전송을 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            await prisma.careRequest.update({
              where: { id: fixture.careRequestId },
              data: { status: "CANCELED" },
            });
          },
        },
      ]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 두 번째 전송 실패 후 상태가 변경되면 세 번째 재시도 중단
    it("두 번째 전송 후 요청 상태가 일치하지 않으면 마지막 재시도를 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        { statusCode: 500 },
        {
          statusCode: 503,
          beforeResponse: async () => {
            await prisma.careRequest.update({
              where: { id: fixture.careRequestId },
              data: { status: "OPEN" },
            });
          },
        },
      ]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 2);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 상태 불일치로 중단되어도 기존 알림과 읽음 상태 유지
    it("SSE 전송 중단 후에도 기존 알림과 읽음 상태를 유지한다", async (t) => {
      const readAt = new Date();
      const fixture = await createTestNotification({ readAt });

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            await prisma.careRequest.update({
              where: { id: fixture.careRequestId },
              data: { status: "CANCELED" },
            });
          },
        },
      ]);

      await deliverCareRequestExpiredNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      await assertNotificationUnchanged(fixture.notification.id, readAt);
    });
  });
});
