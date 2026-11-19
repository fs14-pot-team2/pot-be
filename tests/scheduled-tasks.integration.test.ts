import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { after, before, describe, it, type TestContext } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { scheduledTasksHandler } from "../src/lambda/scheduled-tasks-handler.js";
import { runScheduledTasks } from "../src/services/scheduled-tasks-service.js";
import type { ScheduledTasksOutput } from "../src/types/scheduled-tasks.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

type TestRequestType = "EXPIRED" | "REVIEW" | "STARTED" | "EXPIRING";

type TestFixture = {
  careRequestId: bigint;
  ownerId: bigint;
  sitterId: bigint | null;
};

type RecordedRequest = {
  options: RequestOptions;
  body: string;
};

const COUNT_FIELDS = [
  "expiredCareRequestCount",
  "careRequestExpiredNotificationCount",
  "reviewAvailableNotificationCount",
  "careScheduleNotificationCount",
  "careRequestExpiringNotificationCount",
] as const;

// 테스트에 사용할 KST 기준 날짜
function dateOffset(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 예약 작업별 독립적인 팟오너, 돌봄 요청 및 필요한 견적 생성
async function createTestRequest(type: TestRequestType): Promise<TestFixture> {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `scheduled-owner-${uniqueId}@example.com`,
      nickname: `scheduled-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const matched = type === "REVIEW" || type === "STARTED";

  const startOffsetDays = type === "REVIEW" ? -3 : type === "EXPIRED" ? -1 : 0;
  const endOffsetDays = type === "REVIEW" ? -1 : 2;

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: dateOffset(startOffsetDays),
      endDate: dateOffset(endOffsetDays),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: null,
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: matched ? "MATCHED" : "OPEN",
    },
  });

  if (type === "EXPIRING") {
    return {
      careRequestId: careRequest.id,
      ownerId: owner.id,
      sitterId: null,
    };
  }

  const sitter = await prisma.user.create({
    data: {
      email: `scheduled-sitter-${uniqueId}@example.com`,
      nickname: `scheduled-sitter-${uniqueId}`,
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

  const quote = await prisma.quote.create({
    data: {
      careRequestId: careRequest.id,
      sitterId: sitter.id,
      type: "GENERAL",
      price: 50000,
      comment: "테스트 견적 코멘트입니다.",
    },
  });

  if (matched) {
    await prisma.careRequest.update({
      where: { id: careRequest.id },
      data: { confirmedQuoteId: quote.id },
    });
  }

  return {
    careRequestId: careRequest.id,
    ownerId: owner.id,
    sitterId: sitter.id,
  };
}

// 네 가지 예약 작업의 실제 대상 데이터를 독립적으로 생성
async function createScheduledTaskFixtures() {
  const expired = await createTestRequest("EXPIRED");
  const review = await createTestRequest("REVIEW");
  const started = await createTestRequest("STARTED");
  const expiring = await createTestRequest("EXPIRING");

  return { expired, review, started, expiring };
}

// 운영 HTTPS 함수를 변경하지 않고 테스트 범위에서만 성공 응답 재현
function mockHttpsRequests(t: TestContext) {
  const requests: RecordedRequest[] = [];

  const requestMock = t.mock.method(https, "request", ((
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => {
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

      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          resume: () => void;
        };

        response.statusCode = 204;
        response.resume = () => {};

        onResponse(response as unknown as IncomingMessage);
        response.emit("end");
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

// 처리 건수 필드와 신규 생성 알림 목록의 합계 일치 확인
function assertScheduledTasksOutput(result: ScheduledTasksOutput) {
  assert.deepEqual(Object.keys(result).sort(), [...COUNT_FIELDS, "notifications"].sort());

  for (const field of COUNT_FIELDS) {
    assert.equal(typeof result[field], "number");
    assert.ok(Number.isInteger(result[field]));
    assert.ok(result[field] >= 0);
  }

  assert.equal(
    result.notifications.length,
    result.careRequestExpiredNotificationCount +
      result.reviewAvailableNotificationCount +
      result.careScheduleNotificationCount +
      result.careRequestExpiringNotificationCount,
  );
}

// 실행 결과에서 해당 돌봄 요청의 신규 생성 알림만 조회
function findCreatedNotifications(result: ScheduledTasksOutput, careRequestId: bigint) {
  return result.notifications.filter(
    (notification) => notification.careRequestId === careRequestId.toString(),
  );
}

// 반환된 알림 식별자와 실제 DB 저장값의 일치 여부 확인
async function assertSavedNotifications(result: ScheduledTasksOutput) {
  const ids = result.notifications.map(({ id }) => {
    assert.match(id, /^[1-9]\d*$/);
    return BigInt(id);
  });

  assert.equal(new Set(ids.map(String)).size, ids.length);

  const savedNotifications = await prisma.notification.findMany({
    where: { id: { in: ids } },
  });

  assert.equal(savedNotifications.length, ids.length);

  const savedById = new Map(
    savedNotifications.map((notification) => [notification.id.toString(), notification]),
  );

  for (const notification of result.notifications) {
    assert.match(notification.recipientId, /^[1-9]\d*$/);
    assert.match(notification.careRequestId, /^[1-9]\d*$/);

    const saved = savedById.get(notification.id);

    assert.ok(saved);
    assert.equal(notification.recipientId, saved.recipientId.toString());
    assert.equal(notification.careRequestId, saved.careRequestId.toString());

    if ("scheduledDate" in notification) {
      assert.equal(notification.scheduledDate, getTodayInKst());
    }

    if ("event" in notification) {
      assert.ok(notification.event === "STARTED" || notification.event === "ENDING");
    }
  }
}

describe("예약 작업 공통 실행 및 Lambda 연동", () => {
  let originalSecret: string | undefined;
  let originalEbIp: string | undefined;

  before(() => {
    originalSecret = process.env.INTERNAL_SSE_SECRET;
    originalEbIp = process.env.INTERNAL_SSE_EB_PRIVATE_IP;

    process.env.INTERNAL_SSE_SECRET = "scheduled-tasks-test-secret";
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

  describe("Input/Output 계약", () => {
    // 신규 알림의 BigInt 식별자가 문자열로 직렬화되고 유형별 추가 정보가 유지되는지 확인
    it("알림 식별자를 문자열로 반환하고 기존 알림별 응답 구조를 유지한다", async (t) => {
      const fixtures = await createScheduledTaskFixtures();
      const requests = mockHttpsRequests(t);

      const result = await runScheduledTasks();

      assertScheduledTasksOutput(result);
      await assertSavedNotifications(result);

      const expired = findCreatedNotifications(result, fixtures.expired.careRequestId);
      const review = findCreatedNotifications(result, fixtures.review.careRequestId);
      const started = findCreatedNotifications(result, fixtures.started.careRequestId);
      const expiring = findCreatedNotifications(result, fixtures.expiring.careRequestId);

      assert.equal(expired.length, 1);
      assert.equal(review.length, 1);
      assert.equal(started.length, 2);
      assert.equal(expiring.length, 1);

      assert.deepEqual(
        Object.keys(expired[0]).sort(),
        ["id", "recipientId", "careRequestId"].sort(),
      );

      assert.deepEqual(
        Object.keys(review[0]).sort(),
        ["id", "recipientId", "careRequestId"].sort(),
      );

      for (const notification of started) {
        assert.deepEqual(
          Object.keys(notification).sort(),
          ["id", "recipientId", "careRequestId", "event", "scheduledDate"].sort(),
        );

        assert.ok("event" in notification);
        assert.equal(notification.event, "STARTED");
      }

      assert.deepEqual(
        Object.keys(expiring[0]).sort(),
        ["id", "recipientId", "careRequestId", "scheduledDate"].sort(),
      );

      assert.equal(requests.length, result.notifications.length);
    });
  });

  describe("공통 예약 작업 실행", () => {
    // Lambda Handler 없이 기존 Service를 호출해 돌봄 요청 만료 상태를 저장하는지 확인
    it("Lambda Handler 없이 예약 작업을 실행하고 처리 결과를 반환한다", async (t) => {
      const fixture = await createTestRequest("EXPIRED");
      mockHttpsRequests(t);

      const result = await runScheduledTasks();

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: fixture.careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.ok(result.expiredCareRequestCount >= 1);
      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);

      assertScheduledTasksOutput(result);
    });

    // 네 가지 예약 작업의 처리 건수와 실제 신규 생성 알림 DB 저장값의 일치 여부 확인
    it("예약 작업별 처리 건수와 신규 생성 알림 목록을 일치하게 반환한다", async (t) => {
      const fixtures = await createScheduledTaskFixtures();
      const requests = mockHttpsRequests(t);

      const result = await runScheduledTasks();

      assertScheduledTasksOutput(result);
      await assertSavedNotifications(result);

      assert.ok(result.expiredCareRequestCount >= 1);
      assert.ok(result.careRequestExpiredNotificationCount >= 1);
      assert.ok(result.reviewAvailableNotificationCount >= 1);
      assert.ok(result.careScheduleNotificationCount >= 2);
      assert.ok(result.careRequestExpiringNotificationCount >= 1);

      assert.equal(findCreatedNotifications(result, fixtures.expired.careRequestId).length, 1);
      assert.equal(findCreatedNotifications(result, fixtures.review.careRequestId).length, 1);
      assert.equal(findCreatedNotifications(result, fixtures.started.careRequestId).length, 2);
      assert.equal(findCreatedNotifications(result, fixtures.expiring.careRequestId).length, 1);

      assert.equal(requests.length, result.notifications.length);

      const sentIds = requests.map(({ body }) => {
        const parsed = JSON.parse(body) as {
          notificationId: string;
          recipientId: string;
        };

        return `${parsed.notificationId}:${parsed.recipientId}`;
      });

      const returnedIds = result.notifications.map(({ id, recipientId }) => `${id}:${recipientId}`);

      assert.deepEqual(sentIds, returnedIds);
    });
  });

  describe("Lambda Handler 연동", () => {
    // 기존 Lambda Handler가 공통 실행 결과를 변경하지 않고 반환하는지 확인
    it("Lambda Handler를 통해 실행해도 공통 예약 작업의 반환 구조를 유지한다", async (t) => {
      const fixture = await createTestRequest("EXPIRING");
      mockHttpsRequests(t);

      const originalDisconnect = prisma.$disconnect;
      let disconnectCount = 0;

      // 테스트 종료 시 원본 Prisma 연결 종료 메서드 복원
      prisma.$disconnect = async () => {
        disconnectCount++;
      };

      t.after(() => {
        prisma.$disconnect = originalDisconnect;
      });

      const result = await scheduledTasksHandler();

      assertScheduledTasksOutput(result);
      await assertSavedNotifications(result);

      assert.equal(findCreatedNotifications(result, fixture.careRequestId).length, 1);
      assert.equal(disconnectCount, 1);
    });

    // 정상 실행과 오류 발생 시 모두 Prisma 연결 종료 함수가 호출되는지 확인
    it("정상 실행과 오류 발생 시 Prisma 연결을 종료한다", async (t) => {
      const originalTransaction = prisma.$transaction;
      const originalDisconnect = prisma.$disconnect;
      let disconnectCount = 0;

      prisma.$disconnect = async () => {
        disconnectCount++;
      };

      t.after(() => {
        prisma.$transaction = originalTransaction;
        prisma.$disconnect = originalDisconnect;
      });

      mockHttpsRequests(t);

      await scheduledTasksHandler();
      assert.equal(disconnectCount, 1);

      const transactionError = new Error("예약 작업 트랜잭션 실패");

      prisma.$transaction = async () => {
        throw transactionError;
      };

      await assert.rejects(scheduledTasksHandler(), (error: unknown) => error === transactionError);

      assert.equal(disconnectCount, 2);
    });

    // 공통 예약 작업에서 발생한 Prisma 오류를 변환하지 않고 전달하는지 확인
    it("공통 예약 작업 실행 중 DB 오류가 발생하면 원본 Prisma 오류를 전달한다", async (t) => {
      const originalTransaction = prisma.$transaction;
      const originalDisconnect = prisma.$disconnect;

      const prismaError = Object.assign(new Error("Record not found"), {
        code: "P2025",
      });

      let disconnectCount = 0;

      prisma.$transaction = async () => {
        throw prismaError;
      };

      prisma.$disconnect = async () => {
        disconnectCount++;
      };

      t.after(() => {
        prisma.$transaction = originalTransaction;
        prisma.$disconnect = originalDisconnect;
      });

      await assert.rejects(
        scheduledTasksHandler(),
        (error: unknown) =>
          error === prismaError &&
          error instanceof Error &&
          "code" in error &&
          error.code === "P2025",
      );

      assert.equal(disconnectCount, 1);
    });
  });
});
