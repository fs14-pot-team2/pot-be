import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { cancelCareRequestService } from "../src/services/care-request-service.js";
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

// 실제 트랜잭션 내부에서 알림 일괄 저장 시점에만 오류 발생
function createNotificationFailureRunner(notificationError: Error): TransactionRunner {
  return (callback) =>
    prisma.$transaction(async (tx) => {
      const failureTx = new Proxy(tx, {
        get(target, property) {
          if (property === "notification") {
            return new Proxy(target.notification, {
              get(model, method) {
                if (method === "createMany") {
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
  describe("동시성 및 트랜잭션", () => {
    // 복수 알림 저장 실패 시 돌봄 요청 취소를 롤백하고 기존 견적을 유지하는지 확인
    it("복수 알림 저장 실패 시 돌봄 요청 취소를 롤백한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

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
    });
  });
});
