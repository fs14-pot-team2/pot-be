import { prisma } from "../config/prisma.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import type { DbClient } from "../types/db.js";

const messageSelect = {
  id: true,
  senderId: true,
  content: true,
  createdAt: true,
} as const;

const participantWhere = (userId: bigint) => ({
  OR: [{ ownerId: userId }, { sitterId: userId }],
});

// 쪽지 상대방 확인용 (id, role만)
export function findMessageReceiverById(userId: bigint, db: DbClient = prisma) {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
}

export function findConversationByPair(ownerId: bigint, sitterId: bigint, db: DbClient = prisma) {
  return db.conversation.findUnique({
    where: { ownerId_sitterId: { ownerId, sitterId } },
    select: { id: true },
  });
}

export function findConversationById(conversationId: bigint, db: DbClient = prisma) {
  return db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, ownerId: true, sitterId: true },
  });
}

// 대화방 목록 (최근 쪽지 순, 같은 시각이면 id 내림차순). take는 limit + 1을 넘긴다.
export function findConversationsByUserId(userId: bigint, cursor: bigint | null, take: number) {
  return prisma.conversation.findMany({
    where: participantWhere(userId),
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take,
    ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      ownerId: true,
      sitterId: true,
      lastMessageAt: true,
      owner: {
        select: {
          id: true,
          nickname: true,
          ownerProfile: { select: { profileImageUrl: true } },
        },
      },
      sitter: {
        select: {
          id: true,
          nickname: true,
          sitterProfile: { select: { profileImageUrl: true } },
        },
      },
    },
  });
}

// 주어진 대화방 중 본인이 받은 미확인 쪽지가 있는 대화방 ID 집합
export async function findUnreadConversationIds(userId: bigint, conversationIds: bigint[]) {
  const rows = await prisma.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
      readAt: null,
    },
    distinct: ["conversationId"],
    select: { conversationId: true },
  });

  return new Set(rows.map((row) => row.conversationId));
}

// 쪽지 목록 (최신순으로 조회, 서비스에서 오래된 순으로 뒤집는다). take는 limit + 1을 넘긴다.
export function findMessagesByConversationId(
  conversationId: bigint,
  cursor: bigint | null,
  take: number,
) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: messageSelect,
  });
}

// 기존 대화방에 쪽지 추가
export function createMessage(
  data: { conversationId: bigint; senderId: bigint; content: string; createdAt: Date },
  db: DbClient = prisma,
) {
  return db.message.create({ data, select: messageSelect });
}

// 마지막 쪽지 시각 갱신 (동시 발송 시 시각이 뒤로 가지 않도록 더 이른 경우에만 갱신)
export function touchConversation(conversationId: bigint, at: Date, db: DbClient = prisma) {
  return db.conversation.updateMany({
    where: { id: conversationId, lastMessageAt: { lt: at } },
    data: { lastMessageAt: at },
  });
}

// 최초 발송: 대화방과 첫 쪽지를 함께 생성
export function createConversationWithMessage(
  data: { ownerId: bigint; sitterId: bigint; senderId: bigint; content: string; at: Date },
  db: DbClient = prisma,
) {
  return db.conversation.create({
    data: {
      ownerId: data.ownerId,
      sitterId: data.sitterId,
      lastMessageAt: data.at,
      messages: {
        create: { senderId: data.senderId, content: data.content, createdAt: data.at },
      },
    },
    select: { id: true, messages: { select: messageSelect } },
  });
}

// 팟오너의 진행 중(OPEN, 시작일이 지나지 않은) 돌봄 요청에 해당 팟트너가 견적을 보냈는지
export async function hasQuoteOnOpenCareRequest(
  ownerId: bigint,
  sitterId: bigint,
  today: Date,
  db: DbClient = prisma,
) {
  const quote = await db.quote.findFirst({
    where: {
      sitterId,
      careRequest: {
        ownerId,
        status: CareRequestStatus.OPEN,
        startDate: { gte: today },
      },
    },
    select: { id: true },
  });

  return quote !== null;
}

// 본인이 받은 미확인 쪽지 일괄 읽음 처리
export function markMessagesAsRead(conversationId: bigint, userId: bigint, readAt: Date) {
  return prisma.message.updateMany({
    where: { conversationId, senderId: { not: userId }, readAt: null },
    data: { readAt },
  });
}

// 전체 대화방 기준 미확인 수신 쪽지 존재 여부
export async function existsUnreadMessage(userId: bigint) {
  const message = await prisma.message.findFirst({
    where: {
      senderId: { not: userId },
      readAt: null,
      conversation: participantWhere(userId),
    },
    select: { id: true },
  });

  return message !== null;
}
