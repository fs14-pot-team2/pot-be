import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getNotifications } from "../src/services/notification-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

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
      email: `notification-owner-${uniqueId}@example.com`,
      nickname: `notification-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `notification-sitter-${uniqueId}@example.com`,
      nickname: `notification-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
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

// 테스트에 사용할 알림 생성
function createTestNotification(
  recipientId: bigint,
  careRequestId: bigint,
  message: string,
  createdAt: Date,
  readAt: Date | null = null,
) {
  return prisma.notification.create({
    data: {
      recipientId,
      careRequestId,
      type: "QUOTE_RECEIVED",
      message,
      createdAt,
      readAt,
    },
  });
}

describe("알림 목록 조회", () => {
  describe("조회 조건", () => {
    // 팟오너와 팟트너가 본인 알림만 조회하고 메시지 및 읽음 정보를 유지하는지 확인
    it("본인의 알림만 반환하고 알림 정보를 유지한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();
      const createdAt = new Date("2026-11-01T00:00:00.000Z");
      const readAt = new Date("2026-11-02T00:00:00.000Z");

      const ownerNotification = await createTestNotification(
        ownerId,
        careRequestId,
        "팟오너에게 전달된 알림입니다.",
        createdAt,
      );

      const sitterNotification = await createTestNotification(
        sitterId,
        careRequestId,
        "팟트너에게 전달된 알림입니다.",
        createdAt,
        readAt,
      );

      const ownerNotifications = await getNotifications(ownerId, {
        cursor: null,
        limit: 8,
      });

      const sitterNotifications = await getNotifications(sitterId, {
        cursor: null,
        limit: 8,
      });

      assert.deepEqual(
        ownerNotifications.items.map((notification) => notification.id),
        [ownerNotification.id],
      );
      assert.deepEqual(
        sitterNotifications.items.map((notification) => notification.id),
        [sitterNotification.id],
      );

      assert.equal(ownerNotifications.items[0]?.type, ownerNotification.type);
      assert.equal(ownerNotifications.items[0]?.message, ownerNotification.message);
      assert.equal(ownerNotifications.items[0]?.readAt, null);
      assert.equal(ownerNotifications.items[0]?.createdAt.getTime(), createdAt.getTime());

      assert.equal(sitterNotifications.items[0]?.type, sitterNotification.type);
      assert.equal(sitterNotifications.items[0]?.message, sitterNotification.message);
      assert.equal(sitterNotifications.items[0]?.readAt?.getTime(), readAt.getTime());

      assert.equal(ownerNotifications.nextCursor, null);
      assert.equal(ownerNotifications.hasNext, false);
      assert.equal(sitterNotifications.nextCursor, null);
      assert.equal(sitterNotifications.hasNext, false);
    });

    // 본인 알림이 없는 경우 빈 목록과 종료 정보를 반환하는지 확인
    it("알림이 없으면 빈 목록을 반환한다", async () => {
      const { ownerId } = await createTestRequest();

      const notifications = await getNotifications(ownerId, {
        cursor: null,
        limit: 8,
      });

      assert.deepEqual(notifications, {
        items: [],
        nextCursor: null,
        hasNext: false,
      });
    });
  });

  describe("정렬 및 페이지네이션", () => {
    // 생성일 및 ID 내림차순으로 커서를 이동하고 중복·누락 없이 조회하는지 확인
    it("생성일 및 ID 내림차순으로 중복·누락 없이 조회한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const createdDates = [
        new Date("2026-11-01T00:00:00.000Z"),
        new Date("2026-11-02T00:00:00.000Z"),
        new Date("2026-11-02T00:00:00.000Z"),
        new Date("2026-11-03T00:00:00.000Z"),
        new Date("2026-11-03T00:00:00.000Z"),
      ];

      const savedNotifications = [];

      for (const [index, createdAt] of createdDates.entries()) {
        const notification = await createTestNotification(
          ownerId,
          careRequestId,
          `페이지네이션 테스트 알림 ${index + 1}`,
          createdAt,
        );

        savedNotifications.push(notification);
      }

      const expectedIds = savedNotifications
        .sort((firstNotification, secondNotification) => {
          const createdAtDifference =
            secondNotification.createdAt.getTime() - firstNotification.createdAt.getTime();

          if (createdAtDifference !== 0) {
            return createdAtDifference;
          }

          if (firstNotification.id > secondNotification.id) {
            return -1;
          }

          if (firstNotification.id < secondNotification.id) {
            return 1;
          }

          return 0;
        })
        .map((notification) => notification.id);

      const receivedIds: bigint[] = [];
      let cursor: bigint | null = null;
      let pageCount = 0;

      while (true) {
        const notifications = await getNotifications(ownerId, {
          cursor,
          limit: 2,
        });

        pageCount += 1;

        assert.ok(pageCount <= expectedIds.length);

        const pageIds = notifications.items.map((notification) => notification.id);

        assert.ok(pageIds.length > 0);
        assert.ok(pageIds.length <= 2);

        receivedIds.push(...pageIds);

        if (!notifications.hasNext) {
          assert.equal(notifications.nextCursor, null);
          break;
        }

        assert.equal(notifications.nextCursor, pageIds[pageIds.length - 1]);

        cursor = notifications.nextCursor;
        assert.notEqual(cursor, null);
      }

      assert.deepEqual(receivedIds, expectedIds);
      assert.equal(new Set(receivedIds).size, expectedIds.length);
      assert.equal(pageCount, Math.ceil(expectedIds.length / 2));
    });
  });

  describe("커서 대상 검증", () => {
    // 존재하지 않는 알림 ID를 전달하면 페이지네이션 오류 반환
    it("존재하지 않는 커서는 INVALID_PAGE_PARAMETER를 반환한다", async () => {
      const { ownerId } = await createTestRequest();

      const notification = await prisma.notification.findFirst({
        orderBy: { id: "desc" },
        select: { id: true },
      });

      const nonexistentId = (notification?.id ?? 0n) + 1n;

      await assert.rejects(
        getNotifications(ownerId, {
          cursor: nonexistentId,
          limit: 8,
        }),
        assertAppError("INVALID_PAGE_PARAMETER", 400),
      );
    });

    // 팟오너가 팟트너 소유의 알림 ID를 커서로 전달하면 페이지네이션 오류 반환
    it("팟오너가 팟트너 소유 커서를 전달하면 INVALID_PAGE_PARAMETER를 반환한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const sitterNotification = await createTestNotification(
        sitterId,
        careRequestId,
        "다른 사용자 소유 알림입니다.",
        new Date(),
      );

      await assert.rejects(
        getNotifications(ownerId, {
          cursor: sitterNotification.id,
          limit: 8,
        }),
        assertAppError("INVALID_PAGE_PARAMETER", 400),
      );
    });
  });
});
