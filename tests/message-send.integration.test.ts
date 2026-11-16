import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "node:test";

import type { Response } from "express";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { sendMessage } from "../src/services/message-service.js";
import { addSseClient, removeSseClient } from "../src/services/sse-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

type SendResult = Awaited<ReturnType<typeof sendMessage>>;

const messageContent = "안녕하세요 돌봄 일정 문의드립니다";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName?: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    ...(constraintName && {
      meta: {
        driverAdapterError: {
          cause: {
            constraint: {
              index: constraintName,
            },
          },
        },
      },
    }),
  });
}

// Prisma P2002 원본 오류 전달 확인
function assertP2002(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2002" &&
    !(error instanceof AppError)
  );
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 각 테스트에서 사용할 독립적인 팟오너, 팟트너 및 돌봄 요청 생성 (견적은 선택)
async function createTestRequest(options: { withQuote?: boolean; startDate?: Date } = {}) {
  const { withQuote = true, startDate = futureDate(7) } = options;
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `message-owner-${uniqueId}@example.com`,
      nickname: `message-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const sitter = await prisma.user.create({
    data: {
      email: `message-sitter-${uniqueId}@example.com`,
      nickname: `message-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
    },
  });

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate,
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

  if (withQuote) {
    await prisma.quote.create({
      data: {
        careRequestId: request.id,
        sitterId: sitter.id,
        type: "GENERAL",
        price: 10000,
        comment: "테스트용 일반 견적입니다.",
      },
    });
  }

  return { ownerId: owner.id, sitterId: sitter.id, careRequestId: request.id };
}

// write 호출 내용만 기록하는 가짜 SSE 응답
function createFakeSseResponse() {
  const frames: string[] = [];
  const response = {
    writableEnded: false,
    destroyed: false,
    write(chunk: string) {
      frames.push(chunk);
      return true;
    },
  } as unknown as Response;
  return { response, frames };
}

describe("쪽지 발송", () => {
  describe("최초 발송", () => {
    // 견적을 받은 팟트너에게 최초 발송하면 대화방과 쪽지가 함께 생성되는지 확인
    it("대화방과 쪽지를 함께 생성하고 lastMessageAt을 쪽지 시각으로 기록한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();

      const result = await sendMessage(ownerId, "OWNER", {
        otherUserId: sitterId,
        content: messageContent,
      });

      assert.equal(result.message.senderId, ownerId);
      assert.equal(result.message.content, messageContent);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { ownerId_sitterId: { ownerId, sitterId } },
      });

      assert.equal(conversation.id, result.conversationId);
      assert.equal(conversation.lastMessageAt.getTime(), result.message.createdAt.getTime());
      assert.equal(await prisma.message.count({ where: { conversationId: conversation.id } }), 1);
    });

    // 앞뒤 공백을 포함한 원문이 그대로 저장되는지 확인
    it("쪽지 내용은 trim 없이 원문 그대로 저장한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const content = `  ${messageContent}  \n`;

      const result = await sendMessage(ownerId, "OWNER", { otherUserId: sitterId, content });

      const savedMessage = await prisma.message.findUniqueOrThrow({
        where: { id: result.message.id },
      });

      assert.equal(savedMessage.content, content);
    });

    // 견적을 보내지 않은 팟트너에게는 최초 발송할 수 없는지 확인
    it("견적을 보내지 않은 팟트너에게는 최초 발송을 차단한다", async () => {
      const { ownerId, sitterId } = await createTestRequest({ withQuote: false });

      await assert.rejects(
        sendMessage(ownerId, "OWNER", { otherUserId: sitterId, content: messageContent }),
        assertAppError("MESSAGE_START_FORBIDDEN", 403),
      );

      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });

    // OPEN이 아닌 돌봄 요청의 견적 대상에게는 최초 발송할 수 없는지 확인
    for (const status of ["MATCHED", "CANCELED", "EXPIRED"] as const) {
      it(`돌봄 요청이 ${status} 상태면 최초 발송을 차단한다`, async () => {
        const { ownerId, sitterId, careRequestId } = await createTestRequest();

        await prisma.careRequest.update({ where: { id: careRequestId }, data: { status } });

        await assert.rejects(
          sendMessage(ownerId, "OWNER", { otherUserId: sitterId, content: messageContent }),
          assertAppError("MESSAGE_START_FORBIDDEN", 403),
        );

        assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
      });
    }

    // 시작일이 지난 OPEN 요청은 만료된 요청으로 보고 최초 발송을 차단하는지 확인
    it("시작일이 지난 OPEN 돌봄 요청이면 최초 발송을 차단한다", async () => {
      const { ownerId, sitterId } = await createTestRequest({ startDate: futureDate(-1) });

      await assert.rejects(
        sendMessage(ownerId, "OWNER", { otherUserId: sitterId, content: messageContent }),
        assertAppError("MESSAGE_START_FORBIDDEN", 403),
      );

      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });

    // 팟트너는 대화방이 없으면 먼저 발송할 수 없는지 확인
    it("팟트너의 최초 발송을 차단한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();

      await assert.rejects(
        sendMessage(sitterId, "SITTER", { otherUserId: ownerId, content: messageContent }),
        assertAppError("MESSAGE_START_FORBIDDEN", 403),
      );

      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });

    // 존재하지 않거나 대화 대상이 될 수 없는 상대방인지 확인
    it("없는 사용자, 자기 자신, 같은 역할의 상대방을 차단한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();

      await assert.rejects(
        sendMessage(ownerId, "OWNER", { otherUserId: 9_000_000_000n, content: messageContent }),
        assertAppError("USER_NOT_FOUND", 404),
      );
      await assert.rejects(
        sendMessage(ownerId, "OWNER", { otherUserId: ownerId, content: messageContent }),
        assertAppError("INVALID_MESSAGE_RECEIVER", 400),
      );
      await assert.rejects(
        sendMessage(sitterId, "SITTER", { otherUserId: sitterId, content: messageContent }),
        assertAppError("INVALID_MESSAGE_RECEIVER", 400),
      );

      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });
  });

  describe("후속 발송", () => {
    // 대화방 생성 후에는 돌봄 요청 상태와 무관하게 양방향 발송이 가능한지 확인
    it("돌봄 요청이 취소된 뒤에도 양방향으로 발송하고 대화방을 재사용한다", async () => {
      const { ownerId, sitterId, careRequestId } = await createTestRequest();

      const first = await sendMessage(ownerId, "OWNER", {
        otherUserId: sitterId,
        content: messageContent,
      });

      await prisma.careRequest.update({
        where: { id: careRequestId },
        data: { status: "CANCELED" },
      });

      const reply = await sendMessage(sitterId, "SITTER", {
        otherUserId: ownerId,
        content: messageContent,
      });
      const followUp = await sendMessage(ownerId, "OWNER", {
        otherUserId: sitterId,
        content: messageContent,
      });

      assert.equal(reply.conversationId, first.conversationId);
      assert.equal(followUp.conversationId, first.conversationId);
      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 1);
      assert.equal(
        await prisma.message.count({ where: { conversationId: first.conversationId } }),
        3,
      );

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: first.conversationId },
      });

      assert.equal(conversation.lastMessageAt.getTime(), followUp.message.createdAt.getTime());
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 동시 최초 발송에도 대화방은 1개만 생성되고 쪽지는 모두 저장되는지 확인
    it("동시 최초 발송 시 대화방은 1개만 생성하고 쪽지는 모두 저장한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const requestCount = 5;

      const results = await Promise.allSettled(
        Array.from({ length: requestCount }, (_, index) =>
          sendMessage(ownerId, "OWNER", {
            otherUserId: sitterId,
            content: `${messageContent} ${index}`,
          }),
        ),
      );

      const succeeded = results.filter(
        (result): result is PromiseFulfilledResult<SendResult> => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(rejected.length, 0, rejected.map((result) => String(result.reason)).join(", "));
      assert.equal(succeeded.length, requestCount);

      const conversations = await prisma.conversation.findMany({ where: { ownerId, sitterId } });

      assert.equal(conversations.length, 1);

      const messages = await prisma.message.findMany({
        where: { conversationId: conversations[0].id },
      });

      assert.equal(messages.length, requestCount);
      assert.equal(new Set(messages.map((message) => message.content)).size, requestCount);

      // 모든 응답이 같은 대화방을 가리키고, lastMessageAt이 가장 늦은 쪽지 시각인지 확인
      for (const result of succeeded) {
        assert.equal(result.value.conversationId, conversations[0].id);
      }

      const latestCreatedAt = Math.max(...messages.map((message) => message.createdAt.getTime()));

      assert.equal(conversations[0].lastMessageAt.getTime(), latestCreatedAt);
    });

    // 대화방이 있는 상태에서 양방향 동시 발송 시 쪽지가 모두 저장되는지 확인
    it("대화방이 있으면 양방향 동시 발송 쪽지를 모두 저장한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();

      const first = await sendMessage(ownerId, "OWNER", {
        otherUserId: sitterId,
        content: messageContent,
      });

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, index) =>
          index % 2 === 0
            ? sendMessage(ownerId, "OWNER", {
                otherUserId: sitterId,
                content: `${messageContent} 팟오너 ${index}`,
              })
            : sendMessage(sitterId, "SITTER", {
                otherUserId: ownerId,
                content: `${messageContent} 팟트너 ${index}`,
              }),
        ),
      );

      assert.equal(results.filter((result) => result.status === "rejected").length, 0);

      const messages = await prisma.message.findMany({
        where: { conversationId: first.conversationId },
      });

      assert.equal(messages.length, 7);
      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 1);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: first.conversationId },
      });
      const latestCreatedAt = Math.max(...messages.map((message) => message.createdAt.getTime()));

      assert.equal(conversation.lastMessageAt.getTime(), latestCreatedAt);
    });

    // 최초 발송 중 트랜잭션이 실패하면 대화방과 쪽지가 함께 롤백되는지 확인
    it("트랜잭션 실패 시 대화방과 쪽지 생성을 롤백한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        sendMessage(
          ownerId,
          "OWNER",
          { otherUserId: sitterId, content: messageContent },
          runTransaction,
        ),
        (error: unknown) => error === transactionError,
      );

      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
      assert.equal(await prisma.message.count({ where: { senderId: ownerId } }), 0);
    });
  });

  describe("실시간 이벤트 발행", () => {
    const connected: Array<{ userId: bigint; response: Response }> = [];

    function connect(userId: bigint) {
      const fake = createFakeSseResponse();
      addSseClient(userId, fake.response);
      connected.push({ userId, response: fake.response });
      return fake;
    }

    // 테스트 간 연결 상태가 섞이지 않도록 모든 연결을 정리
    afterEach(() => {
      for (const { userId, response } of connected.splice(0)) {
        removeSseClient(userId, response);
      }
    });

    // 최초 발송 성공 시 수신자에게만 message.created가 전달되는지 확인
    it("최초 발송 후 수신자에게만 message.created를 발행한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const receiver = connect(sitterId);
      const sender = connect(ownerId);

      const result = await sendMessage(ownerId, "OWNER", {
        otherUserId: sitterId,
        content: messageContent,
      });

      const payload = JSON.stringify({
        conversationId: result.conversationId.toString(),
        messageId: result.message.id.toString(),
        senderId: ownerId.toString(),
      });

      assert.deepEqual(receiver.frames, [`event: message.created\ndata: ${payload}\n\n`]);
      assert.deepEqual(sender.frames, []);
    });

    // 후속 발송(팟트너 → 팟오너)에서도 상대방에게 전달되는지 확인
    it("후속 발송에서도 상대방에게 발행한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      await sendMessage(ownerId, "OWNER", { otherUserId: sitterId, content: messageContent });
      const ownerConnection = connect(ownerId);

      const result = await sendMessage(sitterId, "SITTER", {
        otherUserId: ownerId,
        content: messageContent,
      });

      const payload = JSON.stringify({
        conversationId: result.conversationId.toString(),
        messageId: result.message.id.toString(),
        senderId: sitterId.toString(),
      });

      assert.deepEqual(ownerConnection.frames, [`event: message.created\ndata: ${payload}\n\n`]);
    });

    // 트랜잭션이 실패하면 이벤트를 발행하지 않는지 확인
    it("트랜잭션 실패 시 이벤트를 발행하지 않는다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const receiver = connect(sitterId);
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        sendMessage(
          ownerId,
          "OWNER",
          { otherUserId: sitterId, content: messageContent },
          runTransaction,
        ),
        (error: unknown) => error === transactionError,
      );

      assert.deepEqual(receiver.frames, []);
    });

    // 발송 자체가 거부되면 이벤트를 발행하지 않는지 확인
    it("발송이 거부되면 이벤트를 발행하지 않는다", async () => {
      const { ownerId, sitterId } = await createTestRequest({ withQuote: false });
      const receiver = connect(sitterId);

      await assert.rejects(
        sendMessage(ownerId, "OWNER", { otherUserId: sitterId, content: messageContent }),
        assertAppError("MESSAGE_START_FORBIDDEN", 403),
      );

      assert.deepEqual(receiver.frames, []);
    });

    // 대화방 UNIQUE 충돌로 재시도해도 이벤트는 1회만 발행되는지 확인
    it("UNIQUE 충돌로 재시도해도 이벤트는 1회만 발행한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const receiver = connect(sitterId);
      let calls = 0;

      const runTransaction = async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
        calls += 1;

        if (calls === 1) {
          throw createP2002Error("Conversation_ownerId_sitterId_key");
        }

        return prisma.$transaction(callback);
      };

      const result = await sendMessage(
        ownerId,
        "OWNER",
        { otherUserId: sitterId, content: messageContent },
        runTransaction,
      );

      assert.equal(calls, 2);
      assert.equal(receiver.frames.length, 1);
      assert.ok(receiver.frames[0]!.includes(`"messageId":"${result.message.id}"`));
    });

    // 수신자의 연결이 깨져 있어도 발송은 성공해야 한다
    it("이벤트 전송에 실패해도 쪽지 발송은 성공한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      const broken = {
        writableEnded: false,
        destroyed: false,
        write() {
          throw new Error("write failed");
        },
      } as unknown as Response;
      addSseClient(sitterId, broken);
      connected.push({ userId: sitterId, response: broken });

      // 전송 실패 로그가 테스트 출력에 섞이지 않도록 잠시 막는다
      const originalError = console.error;
      console.error = () => {};
      try {
        const result = await sendMessage(ownerId, "OWNER", {
          otherUserId: sitterId,
          content: messageContent,
        });
        assert.equal(result.message.content, messageContent);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe("UNIQUE 제약 충돌 처리", () => {
    // 대화방 UNIQUE 충돌이 나면 한 번 재시도해 기존 대화방에 쪽지를 저장하는지 확인
    it("대화방 UNIQUE 충돌 시 한 번 재시도해 쪽지를 저장한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      let calls = 0;

      const runTransaction = async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
        calls += 1;

        if (calls === 1) {
          throw createP2002Error("Conversation_ownerId_sitterId_key");
        }

        return prisma.$transaction(callback);
      };

      const result = await sendMessage(
        ownerId,
        "OWNER",
        { otherUserId: sitterId, content: messageContent },
        runTransaction,
      );

      assert.equal(calls, 2);
      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 1);
      assert.equal(
        await prisma.message.count({ where: { conversationId: result.conversationId } }),
        1,
      );
    });

    // 재시도 후에도 충돌하면 무한 재시도 없이 원본 오류를 전달하는지 확인
    it("재시도 후에도 UNIQUE 충돌이 나면 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      let calls = 0;

      const runTransaction = async () => {
        calls += 1;
        throw createP2002Error("Conversation_ownerId_sitterId_key");
      };

      await assert.rejects(
        sendMessage(
          ownerId,
          "OWNER",
          { otherUserId: sitterId, content: messageContent },
          runTransaction,
        ),
        assertP2002,
      );

      assert.equal(calls, 2);
      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });

    // P2002 다른 UNIQUE 제약 충돌 시 재시도 없이 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 다른 UNIQUE 제약이면 재시도 없이 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      let calls = 0;

      const runTransaction = async () => {
        calls += 1;
        throw createP2002Error("User_email_role_key");
      };

      await assert.rejects(
        sendMessage(
          ownerId,
          "OWNER",
          { otherUserId: sitterId, content: messageContent },
          runTransaction,
        ),
        assertP2002,
      );

      assert.equal(calls, 1);
      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });

    // P2002 UNIQUE 제약 이름을 식별할 수 없으면 재시도 없이 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 UNIQUE 제약 이름이 없으면 재시도 없이 원본 Prisma 오류를 전달한다", async () => {
      const { ownerId, sitterId } = await createTestRequest();
      let calls = 0;

      const runTransaction = async () => {
        calls += 1;
        throw createP2002Error();
      };

      await assert.rejects(
        sendMessage(
          ownerId,
          "OWNER",
          { otherUserId: sitterId, content: messageContent },
          runTransaction,
        ),
        assertP2002,
      );

      assert.equal(calls, 1);
      assert.equal(await prisma.conversation.count({ where: { ownerId, sitterId } }), 0);
    });
  });
});
