import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { after, before, describe, it, type TestContext } from "node:test";

import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { deliverCareRequestExpiringNotificationWithRetry } from "../src/services/care-request-expiring-notification-delivery-service.js";
import { createCareRequestExpiringNotifications } from "../src/services/care-request-expiring-notification-service.js";
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

// 실제 DB에 독립적인 알림 및 활성 돌봄 요청 생성
async function createTestNotification(
  options: {
    readAt?: Date | null;
    scheduledDate?: string;
  } = {},
) {
  const { readAt = null, scheduledDate = getTodayInKst() } = options;
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `care-expiring-delivery-owner-${uniqueId}@example.com`,
      nickname: `care-expiring-delivery-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: dateOffset(0),
      endDate: dateOffset(3),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  const savedNotification = await prisma.notification.create({
    data: {
      recipientId: owner.id,
      careRequestId: careRequest.id,
      type: "CARE_REQUEST_EXPIRING",
      message: "확정하지 않은 돌봄요청이 내일 만료돼요!",
      readAt,
    },
  });

  return {
    ownerId: owner.id,
    careRequestId: careRequest.id,
    notification: {
      id: savedNotification.id,
      recipientId: savedNotification.recipientId,
      careRequestId: careRequest.id,
      scheduledDate,
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

// 전송 전후 DB 알림의 저장값과 읽음 상태가 변경되지 않았는지 확인
async function assertNotificationUnchanged(notificationId: bigint, expectedReadAt: Date | null) {
  const savedNotification = await prisma.notification.findUniqueOrThrow({
    where: { id: notificationId },
  });

  assert.equal(savedNotification.type, "CARE_REQUEST_EXPIRING");
  assert.deepEqual(savedNotification.readAt, expectedReadAt);

  assert.equal(
    await prisma.notification.count({
      where: { id: notificationId },
    }),
    1,
  );
}

describe("활성 돌봄 요청 만료 임박 알림 SSE 전달", () => {
  let originalSecret: string | undefined;
  let originalEbIp: string | undefined;

  before(() => {
    originalSecret = process.env.INTERNAL_SSE_SECRET;
    originalEbIp = process.env.INTERNAL_SSE_EB_PRIVATE_IP;

    process.env.INTERNAL_SSE_SECRET = "care-expiring-delivery-test-secret";
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
    // 신규 Delivery Service를 통한 ID 변환 및 기존 HTTPS 인증·연결 설정 확인
    it("HTTPS 요청에 알림 ID와 수신자 ID를 문자열로 전달한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

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

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 요청 성공 시 추가 HTTP 전송이나 재시도 없음
    it("최초 HTTP 응답이 204이면 추가 전송 없이 종료한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 비정상 HTTP 응답 이후 재시도에 성공하면 추가 전송하지 않음
    it("비정상 HTTP 응답 후 204를 받으면 재시도를 중단한다", async (t) => {
      const fixture = await createTestNotification();
      const requests = mockHttpsRequests(t, [{ statusCode: 500 }, { statusCode: 204 }]);
      const errors: unknown[][] = [];

      t.mock.method(console, "error", (...args: unknown[]) => {
        errors.push(args);
      });

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

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

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "돌봄 요청 만료 임박 알림 SSE 전송 최종 실패");

      const failureDetails = errors[0][1] as Record<string, unknown>;

      assert.equal(failureDetails.notificationId, fixture.notification.id.toString());
      assert.equal(failureDetails.statusCode, 503);
      assert.equal(failureDetails.sendCount, 3);

      await assertNotificationUnchanged(fixture.notification.id, readAt);
    });

    // 네트워크 연결 실패도 최대 세 번 재시도하고 이미 생성된 알림 유지
    it("네트워크 오류가 계속되면 최대 3회 전송 후 이미 생성된 알림을 유지한다", async (t) => {
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

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "돌봄 요청 만료 임박 알림 SSE 전송 최종 실패");

      const failureDetails = errors[0][1] as Record<string, unknown>;

      assert.equal(failureDetails.notificationId, fixture.notification.id.toString());
      assert.equal(failureDetails.sendCount, 3);
      assert.equal(failureDetails.error, networkError);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // HTTPS 요청의 timeout 이벤트 발생 시 최대 세 번 전송
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

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "돌봄 요청 만료 임박 알림 SSE 전송 최종 실패");

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

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 3);
      assert.deepEqual(errors, []);

      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 생성된 알림만 SSE 전송하고 반복 실행에서는 재전송하지 않는지 확인
    it("반복 실행 시 이미 생성된 알림의 SSE 이벤트를 재전송하지 않는다", async (t) => {
      const fixture = await createTestNotification();

      // 신규 알림 생성 대상이 되도록 테스트 준비용 알림 제거
      await prisma.notification.delete({
        where: { id: fixture.notification.id },
      });

      const firstResult = await createCareRequestExpiringNotifications();
      const createdNotifications = firstResult.notifications.filter(
        (notification) => notification.careRequestId === fixture.careRequestId,
      );

      assert.equal(createdNotifications.length, 1);

      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      for (const notification of createdNotifications) {
        await deliverCareRequestExpiringNotificationWithRetry(notification);
      }

      assert.equal(requests.length, 1);

      assert.deepEqual(JSON.parse(requests[0].body), {
        notificationId: createdNotifications[0].id.toString(),
        recipientId: fixture.ownerId.toString(),
      });

      const secondResult = await createCareRequestExpiringNotifications();
      const repeatedNotifications = secondResult.notifications.filter(
        (notification) => notification.careRequestId === fixture.careRequestId,
      );

      assert.equal(repeatedNotifications.length, 0);

      for (const notification of repeatedNotifications) {
        await deliverCareRequestExpiringNotificationWithRetry(notification);
      }

      assert.equal(requests.length, 1);

      const savedNotifications = await prisma.notification.findMany({
        where: {
          careRequestId: fixture.careRequestId,
          type: "CARE_REQUEST_EXPIRING",
        },
      });

      assert.equal(savedNotifications.length, 1);
      assert.equal(savedNotifications[0].id, createdNotifications[0].id);
      assert.equal(savedNotifications[0].readAt, null);
    });
  });

  describe("돌봄 요청 상태 및 시작일", () => {
    // 최초 전송은 생성 시 검증 결과를 사용하고 요청 상태를 다시 조회하지 않음
    it("최초 전송은 돌봄 요청 상태가 변경되어도 재조회하지 않는다", async (t) => {
      const fixture = await createTestNotification();

      await prisma.careRequest.update({
        where: { id: fixture.careRequestId },
        data: { status: "MATCHED" },
      });

      const requests = mockHttpsRequests(t, [{ statusCode: 204 }]);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 알림 예정일이 이미 지났다면 최초 SSE 전송도 수행하지 않는지 확인
    it("발생 예정일이 지나면 최초 SSE 전송을 중단한다", async (t) => {
      const yesterday = dateOffset(-1).toISOString().slice(0, 10);
      const fixture = await createTestNotification({
        scheduledDate: yesterday,
      });

      const requests = mockHttpsRequests(t, []);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 0);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 전송 실패 이후 요청이 확정되면 추가 HTTP 전송 중단
    it("재시도 전에 돌봄 요청이 확정되면 추가 전송을 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            await prisma.careRequest.update({
              where: { id: fixture.careRequestId },
              data: { status: "MATCHED" },
            });
          },
        },
      ]);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "MATCHED");
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 전송 실패 이후 요청이 취소되면 추가 HTTP 전송 중단
    it("재시도 전에 돌봄 요청이 취소되면 추가 전송을 중단한다", async (t) => {
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

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 최초 전송 실패 이후 시작일 변경 시 추가 HTTP 전송 중단
    it("재시도 전에 시작일이 변경되면 추가 전송을 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            await prisma.careRequest.update({
              where: { id: fixture.careRequestId },
              data: { startDate: dateOffset(1) },
            });
          },
        },
      ]);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.deepEqual(savedRequest.startDate, dateOffset(1));
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // 두 번째 전송 실패 후 요청 상태가 변경되면 세 번째 재시도 중단
    it("두 번째 전송 후 돌봄 요청 상태가 변경되면 마지막 재시도를 중단한다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        { statusCode: 500 },
        {
          statusCode: 503,
          beforeResponse: async () => {
            await prisma.careRequest.update({
              where: { id: fixture.careRequestId },
              data: { status: "CANCELED" },
            });
          },
        },
      ]);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 2);

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");
      await assertNotificationUnchanged(fixture.notification.id, null);
    });

    // KST 예정일 경과 후에는 재시도 대상에서 제외하는지 확인
    it("발생 예정일이 경과한 알림은 재시도하지 않는다", async (t) => {
      const fixture = await createTestNotification();

      const requests = mockHttpsRequests(t, [
        {
          statusCode: 500,
          beforeResponse: async () => {
            const tomorrow = dateOffset(1).toISOString().slice(0, 10);

            t.mock.timers.enable({
              apis: ["Date"],
              now: new Date(`${tomorrow}T03:00:00.000Z`),
            });
          },
        },
      ]);

      await deliverCareRequestExpiringNotificationWithRetry(fixture.notification);

      assert.equal(requests.length, 1);
      await assertNotificationUnchanged(fixture.notification.id, null);
    });
  });
});
