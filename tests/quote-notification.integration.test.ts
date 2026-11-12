import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import {
  confirmQuoteService,
  createQuote,
  updateQuoteService,
} from "../src/services/quote-service.js";
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
      email: `quote-notification-owner-${uniqueId}@example.com`,
      nickname: `quote-notification-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `quote-notification-sitter-${uniqueId}@example.com`,
      nickname: `quote-notification-sitter-${uniqueId}`,
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

// 테스트에 사용할 기존 견적 생성
function createTestQuote(careRequestId: bigint, sitterId: bigint) {
  return prisma.quote.create({
    data: {
      careRequestId,
      sitterId,
      type: "GENERAL",
      price: 10000,
      comment: "수정 전 테스트용 견적 내용입니다.",
    },
  });
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

describe("견적 도메인 알림 생성", () => {
  describe("생성 조건", () => {
    // 전달된 견적 필드가 실제 변경되면 수정 알림을 생성하는지 확인
    for (const { name, quoteData } of [
      {
        name: "금액만",
        quoteData: { price: 25000 },
      },
      {
        name: "코멘트만",
        quoteData: { comment: "수정 후 테스트용 견적 내용입니다." },
      },
      {
        name: "금액과 코멘트가 모두",
        quoteData: {
          price: 25000,
          comment: "수정 후 테스트용 견적 내용입니다.",
        },
      },
    ]) {
      it(`견적 ${name} 변경되면 QUOTE_UPDATED 알림을 생성한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createTestRequest();
        const quote = await createTestQuote(careRequestId, sitterId);

        await updateQuoteService(sitterId, quote.id, quoteData);

        const notifications = await prisma.notification.findMany({
          where: {
            quoteId: quote.id,
            type: "QUOTE_UPDATED",
          },
        });

        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].recipientId, ownerId);
        assert.equal(notifications[0].careRequestId, careRequestId);
        assert.equal(notifications[0].quoteId, quote.id);
        assert.equal(notifications[0].readAt, null);
      });
    }

    // 수정 전후 금액·코멘트가 동일하면 알림을 생성하지 않는지 확인
    it("변경 없는 PATCH는 알림을 생성하지 않는다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const quote = await createTestQuote(careRequestId, sitterId);

      await updateQuoteService(sitterId, quote.id, {
        price: quote.price,
        comment: quote.comment,
      });

      assert.equal(
        await prisma.notification.count({
          where: {
            careRequestId,
            quoteId: quote.id,
            type: "QUOTE_UPDATED",
          },
        }),
        0,
      );
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 알림 저장 실패 시 같은 트랜잭션에서 생성한 견적을 롤백하는지 확인
    it("알림 저장 실패 시 견적 생성을 롤백한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        createQuote(
          sitterId,
          careRequestId,
          10000,
          "테스트용 견적 내용입니다.",
          createNotificationFailureRunner(notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
      assert.equal(await prisma.notification.count({ where: { careRequestId } }), 0);
    });

    // 알림 저장 실패 시 견적 금액·내용 변경을 롤백하는지 확인
    it("알림 저장 실패 시 견적 수정을 롤백한다", async () => {
      const { sitterId, careRequestId } = await createTestRequest();
      const quote = await createTestQuote(careRequestId, sitterId);
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        updateQuoteService(
          sitterId,
          quote.id,
          {
            price: 25000,
            comment: "수정 후 테스트용 견적 내용입니다.",
          },
          createNotificationFailureRunner(notificationError),
        ),
        (error: unknown) => error === notificationError,
      );

      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
      });

      assert.equal(savedQuote.price, quote.price);
      assert.equal(savedQuote.comment, quote.comment);
      assert.equal(savedQuote.updatedAt.getTime(), quote.updatedAt.getTime());
      assert.equal(await prisma.notification.count({ where: { careRequestId } }), 0);
    });

    // 알림 저장 실패 시 돌봄 요청의 견적 확정 상태를 롤백하는지 확인
    it("알림 저장 실패 시 견적 확정을 롤백한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const quote = await createTestQuote(careRequestId, sitterId);
      const notificationError = new Error("Notification insert failed");

      await assert.rejects(
        confirmQuoteService(ownerId, quote.id, createNotificationFailureRunner(notificationError)),
        (error: unknown) => error === notificationError,
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "OPEN");
      assert.equal(savedRequest.confirmedQuoteId, null);
      assert.equal(await prisma.notification.count({ where: { careRequestId } }), 0);
    });
  });
});
