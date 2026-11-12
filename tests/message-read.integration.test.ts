import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { readConversationMessages } from "../src/services/message-service.js";
import type { UserRole } from "../src/types/auth.js";

const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");

// 기준 시각으로부터 n분 뒤
function minutesAfter(minutes: number) {
  return new Date(BASE_TIME.getTime() + minutes * 60_000);
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 각 테스트에서 사용할 독립적인 사용자 생성
async function createUser(role: UserRole) {
  const uniqueId = randomUUID();

  const user = await prisma.user.create({
    data: {
      email: `message-read-${role.toLowerCase()}-${uniqueId}@example.com`,
      nickname: `message-read-${role.toLowerCase()}-${uniqueId}`,
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

// 대화방과 쪽지를 직접 생성한다. 쪽지는 순서대로 저장하므로 id가 입력 순서대로 증가한다.
async function createConversation(ownerId: bigint, sitterId: bigint, messages: MessageSeed[]) {
  const lastMessageAt = messages.reduce(
    (latest, message) => (message.createdAt > latest ? message.createdAt : latest),
    BASE_TIME,
  );

  const conversation = await prisma.conversation.create({
    data: { ownerId, sitterId, lastMessageAt },
  });

  const messageIds: bigint[] = [];
  for (const message of messages) {
    const created = await prisma.message.create({
      data: { conversationId: conversation.id, ...message },
    });
    messageIds.push(created.id);
  }

  return { conversationId: conversation.id, messageIds };
}

// 쪽지 id 목록의 readAt 값을 id 순서대로 조회
async function findReadAts(messageIds: bigint[]) {
  const rows = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    orderBy: { id: "asc" },
    select: { readAt: true },
  });

  return rows.map((row) => row.readAt);
}

describe("쪽지 읽음 처리", () => {
  describe("읽음 처리 대상", () => {
    // 상대방이 보낸 미확인 쪽지 전체에 readAt이 기록되는지 확인
    it("본인이 받은 미확인 쪽지 전체에 readAt을 기록한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, [
        { senderId: sitterId, content: "첫 번째 쪽지 내용입니다", createdAt: minutesAfter(0) },
        { senderId: sitterId, content: "두 번째 쪽지 내용입니다", createdAt: minutesAfter(1) },
        { senderId: sitterId, content: "세 번째 쪽지 내용입니다", createdAt: minutesAfter(2) },
      ]);

      const before = Date.now();
      await readConversationMessages(ownerId, conversationId);

      const readAts = await findReadAts(messageIds);

      assert.equal(readAts.length, 3);
      readAts.forEach((readAt) => {
        assert.ok(readAt instanceof Date);
        assert.ok(readAt.getTime() >= before);
      });
    });

    // 내가 보낸 쪽지는 읽음 처리 대상이 아닌지 확인
    it("본인이 보낸 쪽지는 읽음 처리하지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, [
        { senderId: ownerId, content: "내가 보낸 쪽지 내용입니다", createdAt: minutesAfter(0) },
        { senderId: sitterId, content: "상대가 보낸 쪽지 내용입니다", createdAt: minutesAfter(1) },
      ]);

      await readConversationMessages(ownerId, conversationId);

      const readAts = await findReadAts(messageIds);

      assert.equal(readAts[0], null);
      assert.ok(readAts[1] instanceof Date);
    });

    // 이미 읽은 쪽지의 readAt을 덮어쓰지 않는지 확인
    it("이미 읽은 쪽지의 readAt은 유지한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const alreadyReadAt = minutesAfter(5);
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, [
        {
          senderId: sitterId,
          content: "이미 읽은 쪽지 내용입니다",
          createdAt: minutesAfter(0),
          readAt: alreadyReadAt,
        },
        {
          senderId: sitterId,
          content: "아직 안 읽은 쪽지 내용입니다",
          createdAt: minutesAfter(1),
        },
      ]);

      await readConversationMessages(ownerId, conversationId);

      const readAts = await findReadAts(messageIds);

      assert.equal(readAts[0]?.getTime(), alreadyReadAt.getTime());
      assert.ok(readAts[1] instanceof Date);
    });

    // 한쪽이 읽어도 상대방이 받은 쪽지는 그대로인지 확인
    it("상대방이 받은 미확인 쪽지에는 영향을 주지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, [
        {
          senderId: sitterId,
          content: "팟오너가 받는 쪽지 내용입니다",
          createdAt: minutesAfter(0),
        },
        {
          senderId: ownerId,
          content: "팟트너가 받는 쪽지 내용입니다",
          createdAt: minutesAfter(1),
        },
      ]);

      await readConversationMessages(ownerId, conversationId);

      const readAts = await findReadAts(messageIds);

      assert.ok(readAts[0] instanceof Date);
      assert.equal(readAts[1], null);
    });

    // 다른 대화방의 쪽지는 건드리지 않는지 확인
    it("다른 대화방의 쪽지는 읽음 처리하지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const otherSitterId = await createUser("SITTER");

      const target = await createConversation(ownerId, sitterId, [
        { senderId: sitterId, content: "대상 대화방 쪽지 내용입니다", createdAt: minutesAfter(0) },
      ]);
      const other = await createConversation(ownerId, otherSitterId, [
        {
          senderId: otherSitterId,
          content: "다른 대화방 쪽지 내용입니다",
          createdAt: minutesAfter(0),
        },
      ]);

      await readConversationMessages(ownerId, target.conversationId);

      assert.ok((await findReadAts(target.messageIds))[0] instanceof Date);
      assert.equal((await findReadAts(other.messageIds))[0], null);
    });

    // 읽을 쪽지가 없어도 에러 없이 처리되는지 확인 (반복 호출 허용)
    it("미확인 쪽지가 없어도 에러 없이 처리한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId } = await createConversation(ownerId, sitterId, [
        { senderId: ownerId, content: "내가 보낸 쪽지 내용입니다", createdAt: minutesAfter(0) },
      ]);

      await readConversationMessages(ownerId, conversationId);
      await readConversationMessages(ownerId, conversationId);
    });

    // 동시에 들어온 읽음 처리 요청이 충돌하지 않고, 기록된 readAt을 덮어쓰지 않는지 확인
    it("동시에 읽음 처리해도 에러 없이 처리하고 기록된 readAt을 덮어쓰지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, [
        { senderId: sitterId, content: "첫 번째 쪽지 내용입니다", createdAt: minutesAfter(0) },
        { senderId: sitterId, content: "두 번째 쪽지 내용입니다", createdAt: minutesAfter(1) },
        { senderId: sitterId, content: "세 번째 쪽지 내용입니다", createdAt: minutesAfter(2) },
      ]);

      await Promise.all(
        Array.from({ length: 5 }, () => readConversationMessages(ownerId, conversationId)),
      );

      const afterConcurrent = await findReadAts(messageIds);
      afterConcurrent.forEach((readAt) => assert.ok(readAt instanceof Date));

      // 이후 다시 호출해도 이미 기록된 readAt은 바뀌지 않아야 한다
      await readConversationMessages(ownerId, conversationId);

      assert.deepEqual(await findReadAts(messageIds), afterConcurrent);
    });

    // 읽음 처리 이후에 도착한 쪽지는 미확인으로 남고, 다음 읽음 처리에서 읽음이 되는지 확인
    it("읽음 처리 이후에 도착한 쪽지는 미확인으로 남는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId } = await createConversation(ownerId, sitterId, [
        { senderId: sitterId, content: "먼저 도착한 쪽지 내용입니다", createdAt: minutesAfter(0) },
      ]);

      await readConversationMessages(ownerId, conversationId);

      const late = await prisma.message.create({
        data: {
          conversationId,
          senderId: sitterId,
          content: "나중에 도착한 쪽지 내용입니다",
          createdAt: minutesAfter(10),
        },
      });

      assert.equal((await findReadAts([late.id]))[0], null);

      await readConversationMessages(ownerId, conversationId);

      assert.ok((await findReadAts([late.id]))[0] instanceof Date);
    });
  });

  describe("접근 검증", () => {
    // 존재하지 않는 대화방인지 확인
    it("없는 대화방이면 CONVERSATION_NOT_FOUND를 반환한다", async () => {
      const ownerId = await createUser("OWNER");

      await assert.rejects(
        readConversationMessages(ownerId, 9_000_000_000n),
        assertAppError("CONVERSATION_NOT_FOUND", 404),
      );
    });

    // 참여자가 아닌 사용자가 읽음 처리할 수 없는지 확인
    it("대화방 참여자가 아니면 CONVERSATION_ACCESS_FORBIDDEN을 반환한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const outsiderId = await createUser("SITTER");
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, [
        {
          senderId: sitterId,
          content: "참여자만 읽을 수 있는 쪽지입니다",
          createdAt: minutesAfter(0),
        },
      ]);

      await assert.rejects(
        readConversationMessages(outsiderId, conversationId),
        assertAppError("CONVERSATION_ACCESS_FORBIDDEN", 403),
      );

      // 거부된 요청이 쪽지 상태를 바꾸지 않아야 한다
      assert.equal((await findReadAts(messageIds))[0], null);
    });
  });
});
