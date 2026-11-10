import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  createConversationWithMessage,
  createMessage,
  existsUnreadMessage,
  findConversationById,
  findConversationByPair,
  findConversationsByUserId,
  findMessageReceiverById,
  findMessagesByConversationId,
  findUnreadConversationIds,
  hasQuoteOnOpenCareRequest,
  markMessagesAsRead,
  touchConversation,
} from "../repositories/message-repository.js";
import type { TransactionRunner } from "../types/db.js";
import type { UserRole } from "../types/auth.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import type { SendMessageInput } from "../validators/message-validator.js";

const CONVERSATION_PAIR_UNIQUE_INDEX = "Conversation_ownerId_sitterId_key";

interface MessageRow {
  id: bigint;
  senderId: bigint;
  content: string;
  createdAt: Date;
}

function toMessageDto(message: MessageRow) {
  return {
    id: message.id,
    senderId: message.senderId,
    content: message.content,
    createdAt: message.createdAt,
  };
}

// 상대방이 존재하고, 본인과 역할이 다른(OWNER ↔ SITTER) 사용자인지 확인
async function getCounterpart(userId: bigint, userRole: UserRole, otherUserId: bigint) {
  const other = await findMessageReceiverById(otherUserId);

  if (!other) {
    throw new AppError("USER_NOT_FOUND");
  }

  // 자기 자신이거나 같은 역할이면 대화 대상이 될 수 없다
  if (other.id === userId || other.role === userRole) {
    throw new AppError("INVALID_MESSAGE_RECEIVER");
  }

  return other;
}

function resolvePair(userId: bigint, userRole: UserRole, otherUserId: bigint) {
  return userRole === "OWNER"
    ? { ownerId: userId, sitterId: otherUserId }
    : { ownerId: otherUserId, sitterId: userId };
}

export async function getConversations(userId: bigint, cursor: bigint | null, limit: number) {
  const rows = await findConversationsByUserId(userId, cursor, limit + 1);

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;

  const unreadIds =
    page.length > 0
      ? await findUnreadConversationIds(
          userId,
          page.map((row) => row.id),
        )
      : new Set<bigint>();

  return {
    items: page.map((row) => {
      const other =
        row.ownerId === userId
          ? {
              id: row.sitter.id,
              nickname: row.sitter.nickname,
              profileImageUrl: row.sitter.sitterProfile?.profileImageUrl ?? null,
            }
          : {
              id: row.owner.id,
              nickname: row.owner.nickname,
              profileImageUrl: row.owner.ownerProfile?.profileImageUrl ?? null,
            };

      return {
        conversationId: row.id,
        otherUser: {
          id: other.id,
          nickname: other.nickname,
          profileImageUrl: other.profileImageUrl,
        },
        lastMessageAt: row.lastMessageAt,
        hasUnreadMessage: unreadIds.has(row.id),
      };
    }),
    nextCursor: hasNextPage ? page[page.length - 1]!.id : null,
    hasNextPage,
  };
}

export async function getMessages(
  userId: bigint,
  userRole: UserRole,
  otherUserId: bigint,
  cursor: bigint | null,
  limit: number,
) {
  await getCounterpart(userId, userRole, otherUserId);

  const { ownerId, sitterId } = resolvePair(userId, userRole, otherUserId);
  const conversation = await findConversationByPair(ownerId, sitterId);

  // 대화방이 없으면 에러 없이 빈 목록 (외부 진입 시 "대화를 시작해보세요" 안내용)
  if (!conversation) {
    return { conversationId: null, items: [], nextCursor: null, hasNextPage: false };
  }

  const rows = await findMessagesByConversationId(conversation.id, cursor, limit + 1);

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;

  return {
    conversationId: conversation.id,
    // 조회는 최신순이라 화면 표시 순서(오래된 순)로 뒤집는다
    items: [...page].reverse().map(toMessageDto),
    // 이번 구간에서 가장 오래된 쪽지 ID. 위로 스크롤할 때 이 값을 cursor로 보낸다
    nextCursor: hasNextPage ? page[page.length - 1]!.id : null,
    hasNextPage,
  };
}

export async function sendMessage(
  userId: bigint,
  userRole: UserRole,
  input: SendMessageInput,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  await getCounterpart(userId, userRole, input.otherUserId);

  const { ownerId, sitterId } = resolvePair(userId, userRole, input.otherUserId);

  const attempt = () =>
    runTransaction(async (tx) => {
      const now = new Date();
      const conversation = await findConversationByPair(ownerId, sitterId, tx);

      // 기존 대화방: 돌봄 요청 상태와 무관하게 양쪽 모두 발송 가능
      if (conversation) {
        const message = await createMessage(
          {
            conversationId: conversation.id,
            senderId: userId,
            content: input.content,
            createdAt: now,
          },
          tx,
        );
        await touchConversation(conversation.id, now, tx);
        return { conversationId: conversation.id, message };
      }

      // 최초 발송: 팟오너만, 본인의 OPEN 돌봄 요청에 견적을 보낸 팟트너에게만 가능
      if (userRole !== "OWNER") {
        throw new AppError("MESSAGE_START_FORBIDDEN");
      }

      const today = new Date(`${getTodayInKst()}T00:00:00.000Z`);
      if (!(await hasQuoteOnOpenCareRequest(ownerId, sitterId, today, tx))) {
        throw new AppError("MESSAGE_START_FORBIDDEN");
      }

      const created = await createConversationWithMessage(
        { ownerId, sitterId, senderId: userId, content: input.content, at: now },
        tx,
      );
      return { conversationId: created.id, message: created.messages[0]! };
    });

  let result: Awaited<ReturnType<typeof attempt>>;
  try {
    result = await attempt();
  } catch (error) {
    // 최초 발송이 동시에 들어와 대화방 UNIQUE 충돌이 나면 한 번만 재시도한다 (이번엔 기존 대화방을 재사용)
    if (getUniqueConstraintName(error) !== CONVERSATION_PAIR_UNIQUE_INDEX) {
      throw error;
    }
    result = await attempt();
  }

  return {
    conversationId: result.conversationId,
    message: toMessageDto(result.message),
  };
}

export async function readConversationMessages(userId: bigint, conversationId: bigint) {
  const conversation = await findConversationById(conversationId);

  if (!conversation) {
    throw new AppError("CONVERSATION_NOT_FOUND");
  }

  if (conversation.ownerId !== userId && conversation.sitterId !== userId) {
    throw new AppError("CONVERSATION_ACCESS_FORBIDDEN");
  }

  await markMessagesAsRead(conversationId, userId, new Date());
}

export async function getUnreadStatus(userId: bigint) {
  return { hasUnreadMessage: await existsUnreadMessage(userId) };
}
