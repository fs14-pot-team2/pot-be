import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import { getUnreadStatus, readConversationMessages } from "../src/services/message-service.js";
import type { UserRole } from "../src/types/auth.js";

const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");

// 기준 시각으로부터 n분 뒤
function minutesAfter(minutes: number) {
  return new Date(BASE_TIME.getTime() + minutes * 60_000);
}

// 각 테스트에서 사용할 독립적인 사용자 생성
async function createUser(role: UserRole) {
  const uniqueId = randomUUID();

  const user = await prisma.user.create({
    data: {
      email: `message-unread-${role.toLowerCase()}-${uniqueId}@example.com`,
      nickname: `message-unread-${role.toLowerCase()}-${uniqueId}`,
      passwordHash: "test-only",
      role,
      ...(role === "OWNER" && { ownerProfile: { create: {} } }),
    },
  });

  return user.id;
}

interface MessageSeed {
  senderId: bigint;
  content: string;
  createdAt: Date;
  readAt?: Date | null;
}

// 대화방과 쪽지를 직접 생성한다.
async function createConversation(ownerId: bigint, sitterId: bigint, messages: MessageSeed[]) {
  const lastMessageAt = messages.reduce(
    (latest, message) => (message.createdAt > latest ? message.createdAt : latest),
    BASE_TIME,
  );

  const conversation = await prisma.conversation.create({
    data: { ownerId, sitterId, lastMessageAt },
  });

  for (const message of messages) {
    await prisma.message.create({
      data: { conversationId: conversation.id, ...message },
    });
  }

  return { conversationId: conversation.id };
}

describe("전체 미확인 쪽지 존재 여부 조회", () => {
  // 받은 쪽지 중 readAt이 null인 것이 있으면 true인지 확인
  it("받은 미확인 쪽지가 있으면 true를 반환한다", async () => {
    const ownerId = await createUser("OWNER");
    const sitterId = await createUser("SITTER");
    await createConversation(ownerId, sitterId, [
      { senderId: sitterId, content: "읽지 않은 쪽지 내용입니다", createdAt: minutesAfter(0) },
    ]);

    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: true });
  });

  // 대화방이 없으면 false인지 확인
  it("대화방이 없으면 false를 반환한다", async () => {
    const ownerId = await createUser("OWNER");

    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: false });
  });

  // 보낸 쪽지는 보낸 사람 기준 미확인이 아니고, 받는 사람 기준으로만 미확인인지 확인
  it("본인이 보낸 쪽지는 미확인으로 보지 않는다", async () => {
    const ownerId = await createUser("OWNER");
    const sitterId = await createUser("SITTER");
    await createConversation(ownerId, sitterId, [
      { senderId: ownerId, content: "내가 보낸 쪽지 내용입니다", createdAt: minutesAfter(0) },
    ]);

    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: false });
    assert.deepEqual(await getUnreadStatus(sitterId), { hasUnreadMessage: true });
  });

  // 이미 읽은 쪽지만 있으면 false인지 확인
  it("받은 쪽지를 모두 읽었으면 false를 반환한다", async () => {
    const ownerId = await createUser("OWNER");
    const sitterId = await createUser("SITTER");
    await createConversation(ownerId, sitterId, [
      {
        senderId: sitterId,
        content: "이미 읽은 쪽지 내용입니다",
        createdAt: minutesAfter(0),
        readAt: minutesAfter(1),
      },
    ]);

    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: false });
  });

  // 내가 참여하지 않은 대화방의 미확인 쪽지는 세지 않는지 확인
  it("본인이 참여하지 않은 대화방의 미확인 쪽지는 포함하지 않는다", async () => {
    const ownerId = await createUser("OWNER");
    const otherOwnerId = await createUser("OWNER");
    const sitterId = await createUser("SITTER");
    await createConversation(otherOwnerId, sitterId, [
      { senderId: sitterId, content: "다른 사람에게 온 쪽지입니다", createdAt: minutesAfter(0) },
    ]);

    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: false });
    assert.deepEqual(await getUnreadStatus(otherOwnerId), { hasUnreadMessage: true });
  });

  // 여러 대화방 중 하나라도 미확인이면 true이고, 모두 읽으면 false인지 확인
  it("여러 대화방 중 하나라도 미확인이면 true, 모두 읽으면 false를 반환한다", async () => {
    const ownerId = await createUser("OWNER");
    const sitterId = await createUser("SITTER");
    const otherSitterId = await createUser("SITTER");

    const first = await createConversation(ownerId, sitterId, [
      { senderId: sitterId, content: "첫 대화방 쪽지 내용입니다", createdAt: minutesAfter(0) },
    ]);
    const second = await createConversation(ownerId, otherSitterId, [
      {
        senderId: otherSitterId,
        content: "둘째 대화방 쪽지 내용입니다",
        createdAt: minutesAfter(0),
      },
    ]);

    await readConversationMessages(ownerId, first.conversationId);
    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: true });

    await readConversationMessages(ownerId, second.conversationId);
    assert.deepEqual(await getUnreadStatus(ownerId), { hasUnreadMessage: false });
  });
});
