import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { Response } from "express";

import { prisma } from "../src/config/prisma.js";
import { cancelCareRequestService } from "../src/services/care-request-service.js";
import { addSseClient, removeSseClient } from "../src/services/sse-service.js";
import type { TransactionRunner } from "../src/types/db.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest() {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `cancel-notification-owner-${uniqueId}@example.com`,
      nickname: `cancel-notification-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitters = await Promise.all(
    Array.from({ length: 2 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `cancel-notification-sitter-${index}-${uniqueId}@example.com`,
          nickname: `cancel-notification-sitter-${index}-${uniqueId}`,
          passwordHash: "test-only",
          role: "SITTER",
          sitterProfile: {
            create: {
              gender: "FEMALE",
              shortIntroduction: "테스트용 팟트너",
              sitterServiceRegions: {
                create: [{ region: "SEOUL" }],
              },
            },
          },
        },
      }),
    ),
  );

  const careRequest = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate: futureDate(7),
      endDate: futureDate(14),
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

  await prisma.quote.createMany({
    data: sitters.map((sitter) => ({
      careRequestId: careRequest.id,
      sitterId: sitter.id,
      type: "GENERAL" as const,
      price: 10000,
      comment: "취소 알림 트랜잭션 검증용 견적 내용입니다.",
    })),
  });

  return {
    ownerId: owner.id,
    careRequestId: careRequest.id,
    sitterIds: sitters.map((sitter) => sitter.id),
  };
}

// 테스트용 SSE 연결을 등록하고 발행된 이벤트 수집
function createSseEventCollector(userId: bigint, failWrite = false) {
  const events: string[] = [];

  const response = {
    writableEnded: false,
    destroyed: false,
    write(frame: string) {
      if (failWrite) {
        throw new Error("SSE write failed");
      }

      events.push(frame);
      return true;
    },
  } as unknown as Response;

  addSseClient(userId, response);

  return { events, response };
}

// 실제 트랜잭션 내부에서 알림 일괄 저장 시점에만 오류 발생
function createNotificationFailureRunner(notificationError: Error): TransactionRunner {
  return (callback) =>
    prisma.$transaction(async (tx) => {
      const failureTx = new Proxy(tx, {
        get(target, property) {
          if (property === "notification") {
            return new Proxy(target.notification, {
              get(model, method) {
                if (method === "createManyAndReturn") {
                  return async () => {
                    throw notificationError;
                  };
                }

                return Reflect.get(model, method);
              },
            });
          }

          return Reflect.get(target, property);
        },
      });

      return callback(failureTx);
    });
}

describe("돌봄 요청 도메인 알림 생성", () => {
  describe("SSE 이벤트 발행", () => {
    // 복수 알림 저장 트랜잭션 커밋 이후 수신자별 SSE 이벤트 발행 확인
    it("돌봄 요청 취소와 복수 알림 저장 트랜잭션 완료 이후 SSE 이벤트를 발행한다", async (t) => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();

      const collectors = sitterIds.map((sitterId) => ({
        sitterId,
        ...createSseEventCollector(sitterId),
      }));

      t.after(() => {
        for (const collector of collectors) {
          removeSseClient(collector.sitterId, collector.response);
        }
      });

      const runTransaction: TransactionRunner = (callback) =>
        prisma.$transaction(async (tx) => {
          const transactionData = await callback(tx);

          for (const collector of collectors) {
            assert.equal(collector.events.length, 0);
          }

          return transactionData;
        });

      const canceledRequest = await cancelCareRequestService(
        ownerId,
        careRequestId,
        runTransaction,
      );

      assert.equal(canceledRequest.status, "CANCELED");

      const notifications = await prisma.notification.findMany({
        where: { careRequestId, type: "CARE_REQUEST_CANCELED" },
        select: { id: true, recipientId: true },
      });

      assert.equal(notifications.length, sitterIds.length);

      for (const collector of collectors) {
        const notification = notifications.find(
          (notification) => notification.recipientId === collector.sitterId,
        );

        assert.ok(notification);
        assert.deepEqual(collector.events, [
          `event: notification.created\ndata: {"notificationId":"${notification.id}"}\n\n`,
        ]);
      }
    });

    // 한 수신자의 SSE 전송 실패가 취소 및 다른 수신자의 이벤트 발행에 영향을 주지 않는지 확인
    it("일부 SSE 이벤트 전송 실패 시에도 돌봄 요청 취소와 다른 수신자의 이벤트 발행을 유지한다", async (t) => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();

      const failedCollector = createSseEventCollector(sitterIds[0], true);
      const successfulCollector = createSseEventCollector(sitterIds[1]);

      t.after(() => {
        removeSseClient(sitterIds[0], failedCollector.response);
        removeSseClient(sitterIds[1], successfulCollector.response);
      });

      const canceledRequest = await cancelCareRequestService(ownerId, careRequestId);

      assert.equal(canceledRequest.status, "CANCELED");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "CANCELED");

      const notifications = await prisma.notification.findMany({
        where: { careRequestId, type: "CARE_REQUEST_CANCELED" },
        select: { id: true, recipientId: true },
      });

      assert.equal(notifications.length, sitterIds.length);
      assert.deepEqual(
        new Set(notifications.map((notification) => notification.recipientId)),
        new Set(sitterIds),
      );

      const successfulNotification = notifications.find(
        (notification) => notification.recipientId === sitterIds[1],
      );

      assert.ok(successfulNotification);
      assert.equal(failedCollector.events.length, 0);
      assert.deepEqual(successfulCollector.events, [
        `event: notification.created\ndata: {"notificationId":"${successfulNotification.id}"}\n\n`,
      ]);
    });
  });

  describe("트랜잭션", () => {
    // 복수 알림 저장 실패 시 돌봄 요청 취소를 롤백하고 기존 견적을 유지하는지 확인
    it("복수 알림 저장 실패 시 돌봄 요청 취소를 롤백한다", async (t) => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

      const collectors = sitterIds.map((sitterId) => ({
        sitterId,
        ...createSseEventCollector(sitterId),
      }));

      t.after(() => {
        for (const collector of collectors) {
          removeSseClient(collector.sitterId, collector.response);
        }
      });

      await assert.rejects(
        cancelCareRequestService(
          ownerId,
          careRequestId,
          createNotificationFailureRunner(notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.confirmedQuoteId, null);

      const savedQuotes = await prisma.quote.findMany({
        where: { careRequestId },
        select: { sitterId: true },
      });

      assert.equal(savedQuotes.length, sitterIds.length);
      assert.deepEqual(new Set(savedQuotes.map((quote) => quote.sitterId)), new Set(sitterIds));

      assert.equal(
        await prisma.notification.count({
          where: { careRequestId, type: "CARE_REQUEST_CANCELED" },
        }),
        0,
      );

      for (const collector of collectors) {
        assert.equal(collector.events.length, 0);
      }
    });
  });
});
