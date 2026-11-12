import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../src/services/notification-service.js";
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
      email: `notification-read-all-owner-${uniqueId}@example.com`,
      nickname: `notification-read-all-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `notification-read-all-sitter-${uniqueId}@example.com`,
      nickname: `notification-read-all-sitter-${uniqueId}`,
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
  readAt: Date | null = null,
) {
  return prisma.notification.create({
    data: {
      recipientId,
      careRequestId,
      type: "QUOTE_RECEIVED",
      message: "알림 일괄 읽음 처리 테스트입니다.",
      readAt,
    },
  });
}

describe("알림 일괄 읽음 처리", () => {
  describe("읽음 처리 조건", () => {
    // 읽음·미확인 알림 혼합 시 미확인 알림만 수정하고 기존 읽음 시각을 유지하는지 확인
    it("미확인 알림만 읽음 처리하고 기존 readAt과 변경 건수를 유지한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const firstReadAt = new Date("2026-11-11T01:00:00.000Z");

      const readNotification = await createTestNotification(ownerId, careRequestId, firstReadAt);

      const unreadNotifications = await Promise.all([
        createTestNotification(ownerId, careRequestId),
        createTestNotification(ownerId, careRequestId),
      ]);

      const notificationUpdateResult = await markAllNotificationsAsRead(ownerId);

      assert.equal(notificationUpdateResult.updatedCount, unreadNotifications.length);

      const savedReadNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: readNotification.id },
      });

      assert.equal(savedReadNotification.readAt?.getTime(), firstReadAt.getTime());

      const savedUnreadNotifications = await prisma.notification.findMany({
        where: {
          id: { in: unreadNotifications.map((notification) => notification.id) },
        },
      });

      for (const notification of savedUnreadNotifications) {
        assert.ok(notification.readAt instanceof Date);
      }

      const repeatedResult = await markAllNotificationsAsRead(ownerId);

      assert.equal(repeatedResult.updatedCount, 0);

      const repeatedNotifications = await prisma.notification.findMany({
        where: {
          id: {
            in: [
              readNotification.id,
              ...unreadNotifications.map((notification) => notification.id),
            ],
          },
        },
      });

      for (const notification of repeatedNotifications) {
        if (notification.id === readNotification.id) {
          assert.equal(notification.readAt?.getTime(), firstReadAt.getTime());
        } else {
          const savedNotification = savedUnreadNotifications.find(
            (saved) => saved.id === notification.id,
          );

          assert.equal(notification.readAt?.getTime(), savedNotification?.readAt?.getTime());
        }
      }
    });
  });

  describe("동시성", () => {
    // 동일 사용자의 동시 일괄 읽음 요청 시 중복 갱신 없이 변경 건수 정합성을 유지하는지 확인
    it("동일 사용자의 동시 일괄 읽음 요청 시 중복 갱신을 방지하고 변경 건수를 유지한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();

      const notifications = await Promise.all(
        Array.from({ length: 3 }, () => createTestNotification(ownerId, careRequestId)),
      );

      const notificationUpdateResults = await Promise.all([
        markAllNotificationsAsRead(ownerId),
        markAllNotificationsAsRead(ownerId),
      ]);

      const savedNotifications = await prisma.notification.findMany({
        where: {
          id: { in: notifications.map((notification) => notification.id) },
        },
      });

      assert.equal(
        notificationUpdateResults.reduce(
          (totalCount, notificationUpdateResult) =>
            totalCount + notificationUpdateResult.updatedCount,
          0,
        ),
        notifications.length,
      );

      for (const notification of savedNotifications) {
        assert.ok(notification.readAt instanceof Date);
      }

      const savedReadAtById = new Map(
        savedNotifications.map((notification) => [notification.id, notification.readAt?.getTime()]),
      );

      const repeatedResult = await markAllNotificationsAsRead(ownerId);

      assert.equal(repeatedResult.updatedCount, 0);

      const repeatedNotifications = await prisma.notification.findMany({
        where: {
          id: { in: notifications.map((notification) => notification.id) },
        },
      });

      for (const notification of repeatedNotifications) {
        assert.equal(notification.readAt?.getTime(), savedReadAtById.get(notification.id));
      }
    });

    // 단건 읽음 처리와 일괄 읽음 처리의 경합 시 최초 읽음 시각이 유지되는지 확인
    it("단건 읽음 처리와 일괄 읽음 처리 간 경합 시 최초 readAt을 유지한다", async () => {
      const { ownerId, careRequestId } = await createTestRequest();
      const notification = await createTestNotification(ownerId, careRequestId);

      const [readNotification, notificationUpdateResult] = await Promise.all([
        markNotificationAsRead(ownerId, notification.id),
        markAllNotificationsAsRead(ownerId),
      ]);

      const savedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(readNotification.id, notification.id);
      assert.ok(readNotification.readAt instanceof Date);
      assert.ok(savedNotification.readAt instanceof Date);
      assert.equal(readNotification.readAt.getTime(), savedNotification.readAt.getTime());

      assert.ok(
        notificationUpdateResult.updatedCount === 0 || notificationUpdateResult.updatedCount === 1,
      );

      const repeatedRead = await markNotificationAsRead(ownerId, notification.id);
      const repeatedUpdate = await markAllNotificationsAsRead(ownerId);

      assert.ok(repeatedRead.readAt instanceof Date);
      assert.equal(repeatedRead.readAt.getTime(), savedNotification.readAt.getTime());
      assert.equal(repeatedUpdate.updatedCount, 0);

      const repeatedNotification = await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });

      assert.equal(repeatedNotification.readAt?.getTime(), savedNotification.readAt.getTime());
    });

    // 서로 다른 사용자의 동시 일괄 읽음 요청 시 수신자별 알림만 수정되는지 확인
    it("다른 사용자 알림과 동시 읽음 처리 시 수신자별 데이터를 격리한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const ownerNotifications = await Promise.all([
        createTestNotification(ownerId, careRequestId),
        createTestNotification(ownerId, careRequestId),
      ]);

      const sitterNotifications = await Promise.all([
        createTestNotification(sitterId, careRequestId),
        createTestNotification(sitterId, careRequestId),
        createTestNotification(sitterId, careRequestId),
      ]);

      const [ownerUpdateResult, sitterUpdateResult] = await Promise.all([
        markAllNotificationsAsRead(ownerId),
        markAllNotificationsAsRead(sitterId),
      ]);

      assert.equal(ownerUpdateResult.updatedCount, ownerNotifications.length);
      assert.equal(sitterUpdateResult.updatedCount, sitterNotifications.length);

      const savedOwnerNotifications = await prisma.notification.findMany({
        where: {
          id: { in: ownerNotifications.map((notification) => notification.id) },
        },
      });

      const savedSitterNotifications = await prisma.notification.findMany({
        where: {
          id: { in: sitterNotifications.map((notification) => notification.id) },
        },
      });

      for (const notification of savedOwnerNotifications) {
        assert.equal(notification.recipientId, ownerId);
        assert.ok(notification.readAt instanceof Date);
      }

      for (const notification of savedSitterNotifications) {
        assert.equal(notification.recipientId, sitterId);
        assert.ok(notification.readAt instanceof Date);
      }
    });
  });
});
