import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import {
  createDesignatedRequest,
  rejectDesignatedRequest,
} from "../src/services/designated-request-service.js";
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

describe("지정 요청 도메인 알림 생성", () => {
  describe("동시성 및 트랜잭션", () => {
    // 알림 저장 실패 시 같은 트랜잭션에서 생성한 지정 요청을 롤백하는지 확인
    it("알림 저장 실패 시 지정 요청 생성을 롤백한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

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
    });

    // 알림 저장 실패 시 반려 이력 생성이 롤백되고 기존 지정 요청은 유지되는지 확인
    it("알림 저장 실패 시 지정 요청 반려를 롤백한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();

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
    });
  });
});
