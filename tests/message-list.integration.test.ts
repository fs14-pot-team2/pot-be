import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { getMessages } from "../src/services/message-service.js";
import type { UserRole } from "../src/types/auth.js";

type MessagePage = Awaited<ReturnType<typeof getMessages>>;

const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");

// 기준 시각으로부터 n분 뒤 (쪽지 시각을 직접 지정해 정렬을 결정적으로 만든다)
function minutesAfter(minutes: number) {
  return new Date(BASE_TIME.getTime() + minutes * 60_000);
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

function toIds(items: { id: bigint }[]) {
  return items.map((item) => item.id);
}

// 각 테스트에서 사용할 독립적인 사용자 생성
async function createUser(role: UserRole) {
  const uniqueId = randomUUID();

  const user = await prisma.user.create({
    data: {
      email: `message-list-${role.toLowerCase()}-${uniqueId}@example.com`,
      nickname: `message-list-${role.toLowerCase()}-${uniqueId}`,
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

// 팟오너와 팟트너가 번갈아 보낸 쪽지를 1분 간격으로 만든다 (짝수: 팟오너, 홀수: 팟트너)
function buildMessages(ownerId: bigint, sitterId: bigint, count: number): MessageSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    senderId: index % 2 === 0 ? ownerId : sitterId,
    content: `${index}번째 쪽지 내용입니다`,
    createdAt: minutesAfter(index),
  }));
}

// nextCursor가 null이 될 때까지 위로 스크롤하듯 모든 구간을 조회한다
async function fetchAllPages(
  userId: bigint,
  userRole: UserRole,
  otherUserId: bigint,
  limit: number,
) {
  const pages: MessagePage[] = [];
  let cursor: bigint | null = null;

  // 구현 오류로 무한 루프가 되는 것을 막는 안전장치
  for (let i = 0; i < 20; i += 1) {
    const page: MessagePage = await getMessages(userId, userRole, otherUserId, cursor, limit);
    pages.push(page);

    if (page.nextCursor === null) {
      break;
    }
    cursor = page.nextCursor;
  }

  return pages;
}

describe("쪽지 목록 조회", () => {
  describe("대화방 존재 여부", () => {
    // 대화방이 없으면 에러 없이 빈 목록을 반환하는지 확인 (외부 진입용)
    it("대화방이 없으면 빈 목록을 정상 반환한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");

      const result = await getMessages(ownerId, "OWNER", sitterId, null, 8);

      assert.deepEqual(result, {
        conversationId: null,
        items: [],
        nextCursor: null,
        hasNextPage: false,
      });
    });

    // 대화방 생성 없이 조회만 해서는 대화방이 만들어지지 않는지 확인
    it("조회만으로는 대화방을 생성하지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");

      await getMessages(ownerId, "OWNER", sitterId, null, 8);

      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });
  });

  describe("상대방 검증", () => {
    // 존재하지 않거나 대화 대상이 될 수 없는 상대방인지 확인
    it("없는 사용자, 자기 자신, 같은 역할의 상대방을 차단한다", async () => {
      const ownerId = await createUser("OWNER");
      const otherOwnerId = await createUser("OWNER");

      await assert.rejects(
        getMessages(ownerId, "OWNER", 9_000_000_000n, null, 8),
        assertAppError("USER_NOT_FOUND", 404),
      );
      await assert.rejects(
        getMessages(ownerId, "OWNER", ownerId, null, 8),
        assertAppError("INVALID_MESSAGE_RECEIVER", 400),
      );
      await assert.rejects(
        getMessages(ownerId, "OWNER", otherOwnerId, null, 8),
        assertAppError("INVALID_MESSAGE_RECEIVER", 400),
      );
    });

    // 같은 역할(팟트너끼리)이면 조회할 수 없는지 확인
    it("팟트너끼리는 조회할 수 없다", async () => {
      const sitterId = await createUser("SITTER");
      const otherSitterId = await createUser("SITTER");

      await assert.rejects(
        getMessages(sitterId, "SITTER", otherSitterId, null, 8),
        assertAppError("INVALID_MESSAGE_RECEIVER", 400),
      );
    });
  });

  describe("목록 구성", () => {
    // 오래된 순 정렬과 응답 필드 확인
    it("쪽지를 오래된 순으로 반환하고 id, senderId, content, createdAt만 포함한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const seeds = buildMessages(ownerId, sitterId, 4);
      const { conversationId, messageIds } = await createConversation(ownerId, sitterId, seeds);

      const result = await getMessages(ownerId, "OWNER", sitterId, null, 8);

      assert.equal(result.conversationId, conversationId);
      assert.deepEqual(toIds(result.items), messageIds);
      assert.equal(result.hasNextPage, false);
      assert.equal(result.nextCursor, null);

      result.items.forEach((item, index) => {
        assert.equal(item.senderId, seeds[index].senderId);
        assert.equal(item.content, seeds[index].content);
        assert.equal(item.createdAt.getTime(), seeds[index].createdAt.getTime());
        assert.deepEqual(Object.keys(item).sort(), ["content", "createdAt", "id", "senderId"]);
      });
    });

    // 팟오너와 팟트너 어느 쪽에서 조회해도 같은 대화방이 나오는지 확인
    it("팟오너와 팟트너 양쪽에서 같은 대화방을 조회한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { conversationId, messageIds } = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 3),
      );

      const asOwner = await getMessages(ownerId, "OWNER", sitterId, null, 8);
      const asSitter = await getMessages(sitterId, "SITTER", ownerId, null, 8);

      assert.equal(asOwner.conversationId, conversationId);
      assert.equal(asSitter.conversationId, conversationId);
      assert.deepEqual(toIds(asOwner.items), messageIds);
      assert.deepEqual(toIds(asSitter.items), messageIds);
    });

    // 다른 팟트너와의 대화방 쪽지가 섞이지 않는지 확인
    it("다른 상대방과 나눈 쪽지는 포함하지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const otherSitterId = await createUser("SITTER");

      const target = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 2),
      );
      const other = await createConversation(
        ownerId,
        otherSitterId,
        buildMessages(ownerId, otherSitterId, 3),
      );

      const result = await getMessages(ownerId, "OWNER", sitterId, null, 8);
      const otherResult = await getMessages(ownerId, "OWNER", otherSitterId, null, 8);

      assert.deepEqual(toIds(result.items), target.messageIds);
      assert.deepEqual(toIds(otherResult.items), other.messageIds);
    });

    // 조회가 읽음 처리를 하지 않는지 확인 (읽음 처리는 별도 API)
    it("조회해도 readAt을 기록하지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { messageIds } = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 2),
      );

      await getMessages(sitterId, "SITTER", ownerId, null, 8);

      const unread = await prisma.message.count({
        where: { id: { in: messageIds }, readAt: null },
      });

      assert.equal(unread, messageIds.length);
    });
  });

  describe("커서 페이지네이션", () => {
    // 최신 구간부터 반환하고, nextCursor로 이전 구간을 이어서 조회하는지 확인
    it("최신 쪽지 구간부터 반환하고 nextCursor로 이전 쪽지를 이어서 조회한다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { messageIds } = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 5),
      );

      const first = await getMessages(ownerId, "OWNER", sitterId, null, 2);

      // 최신 2개가 오래된 순으로 반환되고, 커서는 이 구간에서 가장 오래된 쪽지 id
      assert.deepEqual(toIds(first.items), [messageIds[3], messageIds[4]]);
      assert.equal(first.hasNextPage, true);
      assert.equal(first.nextCursor, messageIds[3]);

      const second = await getMessages(ownerId, "OWNER", sitterId, first.nextCursor, 2);

      assert.deepEqual(toIds(second.items), [messageIds[1], messageIds[2]]);
      assert.equal(second.hasNextPage, true);
      assert.equal(second.nextCursor, messageIds[1]);

      const third = await getMessages(ownerId, "OWNER", sitterId, second.nextCursor, 2);

      assert.deepEqual(toIds(third.items), [messageIds[0]]);
      assert.equal(third.hasNextPage, false);
      assert.equal(third.nextCursor, null);
    });

    // 모든 구간을 이어 붙이면 중복과 누락 없이 전체 쪽지가 되는지 확인
    it("모든 구간을 이어 붙이면 중복과 누락 없이 전체 쪽지가 된다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { messageIds } = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 7),
      );

      const pages = await fetchAllPages(ownerId, "OWNER", sitterId, 3);

      assert.equal(pages.length, 3);

      // 위로 스크롤할수록 이전 구간이므로, 뒤에서 가져온 구간을 앞에 붙인다
      const merged = [...pages].reverse().flatMap((page) => toIds(page.items));

      assert.deepEqual(merged, messageIds);
    });

    // 쪽지 개수가 limit과 같으면 다음 페이지가 없는 것으로 처리하는지 확인
    it("쪽지 개수가 limit과 같으면 hasNextPage는 false다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { messageIds } = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 3),
      );

      const result = await getMessages(ownerId, "OWNER", sitterId, null, 3);

      assert.deepEqual(toIds(result.items), messageIds);
      assert.equal(result.hasNextPage, false);
      assert.equal(result.nextCursor, null);
    });

    // 쪽지 개수가 limit보다 1개 많으면 다음 페이지가 있는 것으로 처리하는지 확인
    it("쪽지 개수가 limit보다 1개 많으면 hasNextPage는 true다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const { messageIds } = await createConversation(
        ownerId,
        sitterId,
        buildMessages(ownerId, sitterId, 4),
      );

      const result = await getMessages(ownerId, "OWNER", sitterId, null, 3);

      assert.deepEqual(toIds(result.items), [messageIds[1], messageIds[2], messageIds[3]]);
      assert.equal(result.hasNextPage, true);
      assert.equal(result.nextCursor, messageIds[1]);
    });

    // createdAt이 같은 쪽지도 id 순서로 안정적으로 정렬되고 페이지 경계에서 누락되지 않는지 확인
    it("createdAt이 같은 쪽지는 id 순서로 정렬하고 페이지 경계에서도 누락하지 않는다", async () => {
      const ownerId = await createUser("OWNER");
      const sitterId = await createUser("SITTER");
      const sameTime = minutesAfter(10);

      const { messageIds } = await createConversation(ownerId, sitterId, [
        { senderId: ownerId, content: "가장 먼저 보낸 쪽지입니다", createdAt: minutesAfter(0) },
        { senderId: sitterId, content: "같은 시각에 보낸 쪽지 1", createdAt: sameTime },
        { senderId: ownerId, content: "같은 시각에 보낸 쪽지 2", createdAt: sameTime },
      ]);

      const whole = await getMessages(ownerId, "OWNER", sitterId, null, 8);

      assert.deepEqual(toIds(whole.items), messageIds);

      // limit 1로 한 개씩 조회해도 같은 시각의 쪽지가 빠지거나 중복되지 않아야 한다
      const pages = await fetchAllPages(ownerId, "OWNER", sitterId, 1);

      assert.equal(pages.length, 3);
      assert.deepEqual(
        pages.flatMap((page) => toIds(page.items)),
        [messageIds[2], messageIds[1], messageIds[0]],
      );
    });
  });
});
