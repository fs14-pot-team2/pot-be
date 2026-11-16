import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { Response } from "express";

import { prisma } from "../src/config/prisma.js";
import {
  createDesignatedRequest,
  rejectDesignatedRequest,
} from "../src/services/designated-request-service.js";
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
      email: `designated-notification-owner-${uniqueId}@example.com`,
      nickname: `designated-notification-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `designated-notification-sitter-${uniqueId}@example.com`,
      nickname: `designated-notification-sitter-${uniqueId}`,
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

  return {
    ownerId: owner.id,
    sitterId: sitter.id,
    careRequestId: careRequest.id,
  };
}

// 실제 트랜잭션 내부에서 알림 저장 시점에만 오류 발생
function createNotificationFailureRunner(notificationError: Error): TransactionRunner {
  return (callback) =>
    prisma.$transaction(async (tx) => {
      const failureTx = new Proxy(tx, {
        get(target, property) {
          if (property === "notification") {
            return new Proxy(target.notification, {
              get(model, method) {
                if (method === "create") {
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

// 테스트 사용자의 SSE 연결을 등록하고 전송된 이벤트 수집
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

  return {
    events,
    response,
  };
}

describe("지정 요청 도메인 알림 생성", () => {
  describe("SSE 이벤트 발행", () => {
    // 트랜잭션이 완료되기 전에는 이벤트를 발행하지 않는지 확인
    it("지정 요청 생성·반려와 알림 저장 트랜잭션 완료 이후 SSE 이벤트를 발행한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const ownerCollector = createSseEventCollector(ownerId);
      const sitterCollector = createSseEventCollector(sitterId);

      t.after(() => {
        removeSseClient(ownerId, ownerCollector.response);
        removeSseClient(sitterId, sitterCollector.response);
      });

      const runTransaction: TransactionRunner = async (callback) => {
        const transactionResult = await prisma.$transaction(callback);

        assert.equal(ownerCollector.events.length, 0);
        assert.equal(sitterCollector.events.length, 0);

        return transactionResult;
      };

      const createdDesignatedRequest = await createDesignatedRequest(
        ownerId,
        careRequestId,
        sitterId,
        runTransaction,
      );

      const receivedNotification = await prisma.notification.findFirstOrThrow({
        where: {
          designatedRequestId: createdDesignatedRequest.id,
          type: "DESIGNATED_REQUEST_RECEIVED",
        },
      });

      assert.deepEqual(sitterCollector.events, [
        `event: notification.created\ndata: {"notificationId":"${receivedNotification.id}"}\n\n`,
      ]);
      assert.equal(ownerCollector.events.length, 0);

      sitterCollector.events.length = 0;

      const createdRejectedRequest = await rejectDesignatedRequest(
        sitterId,
        createdDesignatedRequest.id,
        "해당 일정에는 방문이 어려워 반려합니다.",
        runTransaction,
      );

      const rejectedNotification = await prisma.notification.findFirstOrThrow({
        where: {
          designatedRequestId: createdDesignatedRequest.id,
          type: "DESIGNATED_REQUEST_REJECTED",
        },
      });

      assert.equal(createdRejectedRequest.designatedRequestId, createdDesignatedRequest.id);

      assert.deepEqual(ownerCollector.events, [
        `event: notification.created\ndata: {"notificationId":"${rejectedNotification.id}"}\n\n`,
      ]);
      assert.equal(sitterCollector.events.length, 0);
    });

    // SSE 전송 실패가 커밋된 지정 요청·반려 이력과 알림의 정상 처리 결과에 영향을 주지 않는지 확인
    it("SSE 이벤트 전송 실패 시에도 지정 요청 생성·반려 결과를 유지한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const ownerCollector = createSseEventCollector(ownerId, true);
      const sitterCollector = createSseEventCollector(sitterId, true);

      t.after(() => {
        removeSseClient(ownerId, ownerCollector.response);
        removeSseClient(sitterId, sitterCollector.response);
      });

      const createdDesignatedRequest = await createDesignatedRequest(
        ownerId,
        careRequestId,
        sitterId,
      );

      const savedDesignatedRequest = await prisma.designatedRequest.findUniqueOrThrow({
        where: { id: createdDesignatedRequest.id },
      });

      const receivedNotification = await prisma.notification.findFirstOrThrow({
        where: {
          designatedRequestId: createdDesignatedRequest.id,
          type: "DESIGNATED_REQUEST_RECEIVED",
        },
      });

      assert.equal(savedDesignatedRequest.id, createdDesignatedRequest.id);
      assert.equal(receivedNotification.recipientId, sitterId);

      const createdRejectedRequest = await rejectDesignatedRequest(
        sitterId,
        createdDesignatedRequest.id,
        "해당 일정에는 방문이 어려워 반려합니다.",
      );

      const savedRejectedRequest = await prisma.rejectedRequest.findUniqueOrThrow({
        where: { id: createdRejectedRequest.id },
      });

      const rejectedNotification = await prisma.notification.findFirstOrThrow({
        where: {
          designatedRequestId: createdDesignatedRequest.id,
          type: "DESIGNATED_REQUEST_REJECTED",
        },
      });

      assert.equal(savedRejectedRequest.id, createdRejectedRequest.id);
      assert.equal(rejectedNotification.recipientId, ownerId);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 알림 저장 실패 시 지정 요청을 롤백하고 SSE 이벤트를 발행하지 않는지 확인
    it("알림 저장 실패 시 지정 요청 생성을 롤백한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");
      const { events, response } = createSseEventCollector(sitterId);

      t.after(() => removeSseClient(sitterId, response));

      await assert.rejects(
        createDesignatedRequest(
          ownerId,
          careRequestId,
          sitterId,
          createNotificationFailureRunner(notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      assert.equal(
        await prisma.designatedRequest.count({
          where: { careRequestId, sitterId },
        }),
        0,
      );
      assert.equal(await prisma.notification.count({ where: { careRequestId } }), 0);
      assert.equal(events.length, 0);
    });

    // 알림 저장 실패 시 반려 이력 생성을 롤백하고 SSE 이벤트를 발행하지 않는지 확인
    it("알림 저장 실패 시 지정 요청 반려를 롤백한다", async (t) => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const { events, response } = createSseEventCollector(ownerId);

      t.after(() => removeSseClient(ownerId, response));

      const designatedRequest = await prisma.designatedRequest.create({
        data: {
          careRequestId,
          sitterId,
        },
      });

      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        rejectDesignatedRequest(
          sitterId,
          designatedRequest.id,
          "해당 일정에는 방문이 어려워 반려합니다.",
          createNotificationFailureRunner(notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      assert.equal(
        await prisma.rejectedRequest.count({
          where: { designatedRequestId: designatedRequest.id },
        }),
        0,
      );
      assert.equal(
        await prisma.designatedRequest.count({
          where: { id: designatedRequest.id },
        }),
        1,
      );
      assert.equal(await prisma.notification.count({ where: { careRequestId } }), 0);
      assert.equal(events.length, 0);
    });
  });
});
