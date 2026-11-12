import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  CareRequestStatus,
  Gender,
  NotificationType,
  PrismaClient,
  QuoteType,
  Region,
  ServiceType,
} from "../src/generated/prisma/client.js";
import { assertAllowedSeedTarget } from "../src/config/seed-target.js";
import { hashPassword } from "../src/utils/password.js";

type SeedUser = {
  nickname: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

type SeedOwner = SeedUser & {
  profileImageUrl: string | null;
  preferredServiceTypes: ServiceType[];
  livingRegion: Region | null;
  profileCreatedAt: string;
  profileUpdatedAt: string;
};

type SeedSitter = SeedUser & {
  registered: boolean;
  gender: Gender | null;
  shortIntroduction: string | null;
  description: string | null;
  profileImageUrl: string | null;
  services: ServiceType[];
  regions: Region[];
  profileCreatedAt: string | null;
  profileUpdatedAt: string | null;
};

type SeedDesignatedRequest = {
  sitterIndex: number;
  createdAt: string;
  rejectedReason: string | null;
  rejectedAt: string | null;
};

type SeedQuote = {
  sitterIndex: number;
  type: QuoteType;
  price: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type SeedReview = {
  rating: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type SeedMessage = {
  sender: "OWNER" | "SITTER";
  content: string;
  createdAt: string;
  readAt: string | null;
};

type SeedConversation = {
  ownerIndex: number;
  sitterIndex: number;
  createdAt: string;
  lastMessageAt: string;
  messages: SeedMessage[];
};

type SeedCareRequest = {
  ownerIndex: number;
  status: CareRequestStatus;
  serviceType: ServiceType;
  designated: SeedDesignatedRequest[];
  quotes: SeedQuote[];
  ignoredSitterIndices: number[];
  ignoredAt: string[];
  confirmedSitterIndex: number | null;
  review: SeedReview | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
  location: {
    region: Region;
    sido: string;
    sigungu: string;
    bname: string | null;
    zonecode: string;
    address: string;
    detailAddress: string | null;
  };
};

type SeedData = {
  owners: SeedOwner[];
  sitters: SeedSitter[];
  careRequests: SeedCareRequest[];
  conversations: SeedConversation[];
};

const connectionString = process.env.DATABASE_URL ?? "";
const seedTarget = assertAllowedSeedTarget({
  databaseUrl: connectionString,
  potDevRdsHost: process.env.POT_DEV_RDS_HOST,
  potDevSeedConfirmation: process.env.POT_DEV_SEED_CONFIRMATION,
});

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`시딩 대상 확인: ${seedTarget.kind === "local" ? "로컬 pot" : "개발 RDS pot_dev"}`);

  const json = await readFile(new URL("./data/pot-seed.json", import.meta.url), "utf8");
  const data = JSON.parse(json) as SeedData;

  if (data.owners.length !== 55 || data.sitters.length !== 75) {
    throw new Error("더미 사용자 수가 예상과 다릅니다.");
  }

  const ownerPasswordHashes: string[] = [];
  const sitterPasswordHashes: string[] = [];

  for (let i = 0; i < data.owners.length; i++) {
    ownerPasswordHashes.push(await hashPassword("PotTest!2026"));
  }

  for (let i = 0; i < data.sitters.length; i++) {
    sitterPasswordHashes.push(await hashPassword("PotTest!2026"));
  }

  await prisma.$transaction(
    async (tx) => {
      const ownerIdByIndex = new Map<number, bigint>();
      const sitterIdByIndex = new Map<number, bigint>();
      const careRequestIdByIndex = new Map<number, bigint>();
      const quoteIdByRequestAndSitter = new Map<string, bigint>();
      const designatedRequestIdByRequestAndSitter = new Map<string, bigint>();
      const reviewIdByRequestIndex = new Map<number, bigint>();

      for (const [index, owner] of data.owners.entries()) {
        const passwordHash = ownerPasswordHashes[index];

        const user = await tx.user.upsert({
          where: {
            email_role: { email: owner.email, role: "OWNER" },
          },
          update: {},
          create: {
            nickname: owner.nickname,
            email: owner.email,
            role: "OWNER",
            passwordHash,
            createdAt: new Date(owner.createdAt),
            updatedAt: new Date(owner.updatedAt),
          },
        });

        ownerIdByIndex.set(index, user.id);

        await tx.ownerProfile.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            profileImageUrl: owner.profileImageUrl,
            preferredServiceTypes: owner.preferredServiceTypes,
            livingRegion: owner.livingRegion,
            createdAt: new Date(owner.profileCreatedAt),
            updatedAt: new Date(owner.profileUpdatedAt),
          },
        });
      }

      for (const [index, sitter] of data.sitters.entries()) {
        const passwordHash = sitterPasswordHashes[index];

        const user = await tx.user.upsert({
          where: {
            email_role: { email: sitter.email, role: "SITTER" },
          },
          update: {},
          create: {
            nickname: sitter.nickname,
            email: sitter.email,
            role: "SITTER",
            passwordHash,
            createdAt: new Date(sitter.createdAt),
            updatedAt: new Date(sitter.updatedAt),
          },
        });

        sitterIdByIndex.set(index, user.id);

        if (!sitter.registered) {
          continue;
        }

        if (
          !sitter.gender ||
          !sitter.shortIntroduction ||
          !sitter.profileCreatedAt ||
          !sitter.profileUpdatedAt
        ) {
          throw new Error(`${sitter.email}: 필수 프로필 정보가 없습니다.`);
        }

        await tx.sitterProfile.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            gender: sitter.gender,
            shortIntroduction: sitter.shortIntroduction,
            description: sitter.description,
            profileImageUrl: sitter.profileImageUrl,
            createdAt: new Date(sitter.profileCreatedAt),
            updatedAt: new Date(sitter.profileUpdatedAt),
            sitterServices: {
              create: sitter.services.map((serviceType) => ({
                serviceType,
              })),
            },
            sitterServiceRegions: {
              create: sitter.regions.map((region) => ({
                region,
              })),
            },
          },
        });
      }

      for (const [index, request] of data.careRequests.entries()) {
        const ownerId = ownerIdByIndex.get(request.ownerIndex);

        if (ownerId === undefined) {
          throw new Error(`돌봄 요청 ${index}: 팟오너를 찾을 수 없습니다.`);
        }

        let saved = await tx.careRequest.findFirst({
          where: {
            ownerId,
            createdAt: new Date(request.createdAt),
          },
        });

        if (!saved) {
          saved = await tx.careRequest.create({
            data: {
              ownerId,
              status: request.status,
              serviceType: request.serviceType,
              startDate: new Date(request.startDate),
              endDate: new Date(request.endDate),
              region: request.location.region,
              sido: request.location.sido,
              sigungu: request.location.sigungu,
              bname: request.location.bname,
              zonecode: request.location.zonecode,
              address: request.location.address,
              detailAddress: request.location.detailAddress,
              canceledAt: request.canceledAt ? new Date(request.canceledAt) : null,
              createdAt: new Date(request.createdAt),
              updatedAt: new Date(request.updatedAt),
            },
          });
        }

        careRequestIdByIndex.set(index, saved.id);
      }

      for (const [requestIndex, request] of data.careRequests.entries()) {
        const careRequestId = careRequestIdByIndex.get(requestIndex);

        if (careRequestId === undefined) {
          throw new Error(`돌봄 요청 ${requestIndex}: DB ID를 찾을 수 없습니다.`);
        }

        for (const quote of request.quotes) {
          const sitterId = sitterIdByIndex.get(quote.sitterIndex);

          if (sitterId === undefined) {
            throw new Error(`돌봄 요청 ${requestIndex}: 견적 작성자를 찾을 수 없습니다.`);
          }

          const savedQuote = await tx.quote.upsert({
            where: {
              careRequestId_sitterId: { careRequestId, sitterId },
            },
            update: {},
            create: {
              careRequestId,
              sitterId,
              type: quote.type,
              price: quote.price,
              comment: quote.comment,
              createdAt: new Date(quote.createdAt),
              updatedAt: new Date(quote.updatedAt),
            },
          });

          quoteIdByRequestAndSitter.set(`${requestIndex}:${quote.sitterIndex}`, savedQuote.id);
        }
      }

      for (const [requestIndex, request] of data.careRequests.entries()) {
        const careRequestId = careRequestIdByIndex.get(requestIndex);

        if (careRequestId === undefined) {
          throw new Error(`돌봄 요청 ${requestIndex}: DB ID를 찾을 수 없습니다.`);
        }

        for (const designated of request.designated) {
          const sitterId = sitterIdByIndex.get(designated.sitterIndex);

          if (sitterId === undefined) {
            throw new Error(`돌봄 요청 ${requestIndex}: 지정 팟트너를 찾을 수 없습니다.`);
          }

          const savedDesignated = await tx.designatedRequest.upsert({
            where: {
              careRequestId_sitterId: { careRequestId, sitterId },
            },
            update: {},
            create: {
              careRequestId,
              sitterId,
              createdAt: new Date(designated.createdAt),
            },
          });

          designatedRequestIdByRequestAndSitter.set(
            `${requestIndex}:${designated.sitterIndex}`,
            savedDesignated.id,
          );
        }
      }

      for (const [requestIndex, request] of data.careRequests.entries()) {
        for (const designated of request.designated) {
          if (designated.rejectedReason === null && designated.rejectedAt === null) {
            continue;
          }

          if (designated.rejectedReason === null || designated.rejectedAt === null) {
            throw new Error(`돌봄 요청 ${requestIndex}: 반려 정보가 일치하지 않습니다.`);
          }

          const designatedRequestId = designatedRequestIdByRequestAndSitter.get(
            `${requestIndex}:${designated.sitterIndex}`,
          );

          if (designatedRequestId === undefined) {
            throw new Error(`돌봄 요청 ${requestIndex}: 지정 요청 ID를 찾을 수 없습니다.`);
          }

          await tx.rejectedRequest.upsert({
            where: { designatedRequestId },
            update: {},
            create: {
              designatedRequestId,
              reason: designated.rejectedReason,
              createdAt: new Date(designated.rejectedAt),
            },
          });
        }
      }

      for (const [requestIndex, request] of data.careRequests.entries()) {
        const careRequestId = careRequestIdByIndex.get(requestIndex);

        if (careRequestId === undefined) {
          throw new Error(`돌봄 요청 ${requestIndex}: DB ID를 찾을 수 없습니다.`);
        }

        if (request.ignoredSitterIndices.length !== request.ignoredAt.length) {
          throw new Error(`돌봄 요청 ${requestIndex}: 숨김 정보의 개수가 일치하지 않습니다.`);
        }

        for (const [ignoredIndex, sitterIndex] of request.ignoredSitterIndices.entries()) {
          const sitterId = sitterIdByIndex.get(sitterIndex);
          const ignoredAt = request.ignoredAt[ignoredIndex];

          if (sitterId === undefined || !ignoredAt) {
            throw new Error(`돌봄 요청 ${requestIndex}: 숨김 정보를 찾을 수 없습니다.`);
          }

          await tx.ignoredRequest.upsert({
            where: {
              careRequestId_sitterId: { careRequestId, sitterId },
            },
            update: {},
            create: {
              careRequestId,
              sitterId,
              createdAt: new Date(ignoredAt),
            },
          });
        }
      }

      for (const [requestIndex, request] of data.careRequests.entries()) {
        if (request.status !== "MATCHED") {
          if (request.confirmedSitterIndex !== null) {
            throw new Error(`돌봄 요청 ${requestIndex}: 확정 정보가 일치하지 않습니다.`);
          }
          continue;
        }

        const careRequestId = careRequestIdByIndex.get(requestIndex);
        const confirmedSitterIndex = request.confirmedSitterIndex;

        if (careRequestId === undefined || confirmedSitterIndex === null) {
          throw new Error(`돌봄 요청 ${requestIndex}: 확정 정보를 찾을 수 없습니다.`);
        }

        const confirmedQuoteId = quoteIdByRequestAndSitter.get(
          `${requestIndex}:${confirmedSitterIndex}`,
        );

        if (confirmedQuoteId === undefined) {
          throw new Error(`돌봄 요청 ${requestIndex}: 확정된 견적을 찾을 수 없습니다.`);
        }

        await tx.careRequest.update({
          where: { id: careRequestId },
          data: {
            confirmedQuoteId,
            updatedAt: new Date(request.updatedAt),
          },
        });
      }

      for (const [requestIndex, request] of data.careRequests.entries()) {
        const review = request.review;

        if (review === null) {
          continue;
        }

        if (request.status !== "MATCHED" || request.confirmedSitterIndex === null) {
          throw new Error(`돌봄 요청 ${requestIndex}: 리뷰의 확정 정보가 없습니다.`);
        }

        const careRequestId = careRequestIdByIndex.get(requestIndex);
        const ownerId = ownerIdByIndex.get(request.ownerIndex);
        const sitterId = sitterIdByIndex.get(request.confirmedSitterIndex);

        if (careRequestId === undefined || ownerId === undefined || sitterId === undefined) {
          throw new Error(`돌봄 요청 ${requestIndex}: 리뷰 연결 대상을 찾을 수 없습니다.`);
        }

        const savedReview = await tx.review.upsert({
          where: { careRequestId },
          update: {},
          create: {
            careRequestId,
            ownerId,
            sitterId,
            rating: review.rating,
            content: review.content,
            createdAt: new Date(review.createdAt),
            updatedAt: new Date(review.updatedAt),
          },
        });
        reviewIdByRequestIndex.set(requestIndex, savedReview.id);
      }

      for (const [conversationIndex, conversation] of data.conversations.entries()) {
        const ownerId = ownerIdByIndex.get(conversation.ownerIndex);
        const sitterId = sitterIdByIndex.get(conversation.sitterIndex);

        if (ownerId === undefined || sitterId === undefined) {
          throw new Error(`대화 ${conversationIndex}: 사용자를 찾을 수 없습니다.`);
        }

        if (conversation.messages.length === 0) {
          throw new Error(`대화 ${conversationIndex}: 메시지가 없습니다.`);
        }

        const savedConversation = await tx.conversation.upsert({
          where: {
            ownerId_sitterId: { ownerId, sitterId },
          },
          update: {},
          create: {
            ownerId,
            sitterId,
            createdAt: new Date(conversation.createdAt),
            lastMessageAt: new Date(conversation.lastMessageAt),
          },
        });

        for (const [messageIndex, message] of conversation.messages.entries()) {
          const senderId = message.sender === "OWNER" ? ownerId : sitterId;
          const createdAt = new Date(message.createdAt);

          const existingMessage = await tx.message.findFirst({
            where: {
              conversationId: savedConversation.id,
              senderId,
              createdAt,
            },
          });

          if (existingMessage) {
            if (existingMessage.content !== message.content) {
              throw new Error(
                `대화 ${conversationIndex}, 메시지 ${messageIndex}: 기존 내용과 다릅니다.`,
              );
            }

            continue;
          }

          await tx.message.create({
            data: {
              conversationId: savedConversation.id,
              senderId,
              content: message.content,
              createdAt,
              readAt: message.readAt === null ? null : new Date(message.readAt),
            },
          });
        }
      }

      // 알림 시드: 견적·지정·확정·리뷰 시드 데이터에서 파생
      type SeedNotification = {
        recipientId: bigint;
        careRequestId: bigint;
        quoteId?: bigint;
        designatedRequestId?: bigint;
        reviewId?: bigint;
        type: NotificationType;
        message: string;
        createdAt: Date;
        unread: boolean;
      };

      const notifications: SeedNotification[] = [];

      for (const [requestIndex, request] of data.careRequests.entries()) {
        const careRequestId = careRequestIdByIndex.get(requestIndex);
        const ownerId = ownerIdByIndex.get(request.ownerIndex);

        if (careRequestId === undefined || ownerId === undefined) {
          throw new Error(`돌봄 요청 ${requestIndex}: 알림 대상을 찾을 수 없습니다.`);
        }

        const isOpen = request.status === "OPEN";

        // 팟오너: 견적 도착·수정
        for (const [quoteIndex, quote] of request.quotes.entries()) {
          const sitterNickname = data.sitters[quote.sitterIndex]?.nickname;
          const quoteId = quoteIdByRequestAndSitter.get(`${requestIndex}:${quote.sitterIndex}`);

          if (!sitterNickname || quoteId === undefined) {
            throw new Error(`돌봄 요청 ${requestIndex}: 견적 알림 정보를 찾을 수 없습니다.`);
          }

          const unread = isOpen || quoteIndex % 3 === 0;

          notifications.push({
            recipientId: ownerId,
            careRequestId,
            quoteId,
            type: "QUOTE_RECEIVED",
            message: `${sitterNickname} 팟트너의 돌봄 견적이 도착했어요!`,
            createdAt: new Date(quote.createdAt),
            unread,
          });

          if (quote.updatedAt !== quote.createdAt) {
            notifications.push({
              recipientId: ownerId,
              careRequestId,
              quoteId,
              type: "QUOTE_UPDATED",
              message: `${sitterNickname} 팟트너가 견적을 수정했어요.`,
              createdAt: new Date(quote.updatedAt),
              unread,
            });
          }
        }

        // 팟트너: 지정 요청 도착, 팟오너: 지정 요청 반려
        const ownerNickname = data.owners[request.ownerIndex]?.nickname ?? "팟오너";

        for (const designated of request.designated) {
          const sitterId = sitterIdByIndex.get(designated.sitterIndex);
          const designatedRequestId = designatedRequestIdByRequestAndSitter.get(
            `${requestIndex}:${designated.sitterIndex}`,
          );
          const sitterNickname = data.sitters[designated.sitterIndex]?.nickname;

          if (sitterId === undefined || designatedRequestId === undefined || !sitterNickname) {
            throw new Error(`돌봄 요청 ${requestIndex}: 지정 알림 정보를 찾을 수 없습니다.`);
          }

          notifications.push({
            recipientId: sitterId,
            careRequestId,
            designatedRequestId,
            type: "DESIGNATED_REQUEST_RECEIVED",
            message: `${ownerNickname} 팟오너가 지정견적을 요청했어요!`,
            createdAt: new Date(designated.createdAt),
            unread: isOpen,
          });

          if (designated.rejectedAt !== null) {
            notifications.push({
              recipientId: ownerId,
              careRequestId,
              designatedRequestId,
              type: "DESIGNATED_REQUEST_REJECTED",
              message: `${sitterNickname} 팟트너가 요청을 반려했어요.`,
              createdAt: new Date(designated.rejectedAt),
              unread: isOpen,
            });
          }
        }

        // 팟트너: 견적 확정
        if (request.status === "MATCHED" && request.confirmedSitterIndex !== null) {
          const sitterId = sitterIdByIndex.get(request.confirmedSitterIndex);
          const quoteId = quoteIdByRequestAndSitter.get(
            `${requestIndex}:${request.confirmedSitterIndex}`,
          );

          if (sitterId === undefined || quoteId === undefined) {
            throw new Error(`돌봄 요청 ${requestIndex}: 확정 알림 정보를 찾을 수 없습니다.`);
          }

          notifications.push({
            recipientId: sitterId,
            careRequestId,
            quoteId,
            type: "QUOTE_CONFIRMED",
            message: `${ownerNickname} 팟오너가 내 견적을 확정했어요!`,
            createdAt: new Date(request.updatedAt),
            unread: requestIndex % 2 === 0,
          });
        }

        // 팟트너: 받은 리뷰
        const reviewId = reviewIdByRequestIndex.get(requestIndex);

        if (reviewId !== undefined && request.review && request.confirmedSitterIndex !== null) {
          const sitterId = sitterIdByIndex.get(request.confirmedSitterIndex);

          if (sitterId === undefined) {
            throw new Error(`돌봄 요청 ${requestIndex}: 리뷰 알림 대상을 찾을 수 없습니다.`);
          }

          notifications.push({
            recipientId: sitterId,
            careRequestId,
            reviewId,
            type: "REVIEW_RECEIVED",
            message: `${ownerNickname} 팟오너가 리뷰를 작성했어요.`,
            createdAt: new Date(request.review.createdAt),
            unread: requestIndex % 2 === 0,
          });
        }

        // 팟트너: 견적을 보낸 요청의 취소·만료
        if (request.status === "CANCELED" || request.status === "EXPIRED") {
          const isCanceled = request.status === "CANCELED";
          const occurredAt = isCanceled ? request.canceledAt : request.updatedAt;

          if (occurredAt === null) {
            throw new Error(`돌봄 요청 ${requestIndex}: 취소 시각이 없습니다.`);
          }

          for (const quote of request.quotes) {
            const sitterId = sitterIdByIndex.get(quote.sitterIndex);
            const quoteId = quoteIdByRequestAndSitter.get(`${requestIndex}:${quote.sitterIndex}`);

            if (sitterId === undefined || quoteId === undefined) {
              throw new Error(`돌봄 요청 ${requestIndex}: 취소·만료 알림 정보를 찾을 수 없습니다.`);
            }

            notifications.push({
              recipientId: sitterId,
              careRequestId,
              quoteId,
              type: isCanceled ? "CARE_REQUEST_CANCELED" : "CARE_REQUEST_EXPIRED",
              message: `${ownerNickname} 팟오너의 요청이 ${isCanceled ? "삭제 되었어요." : "만료 되었어요."}`,
              createdAt: new Date(occurredAt),
              unread: requestIndex % 2 === 0,
            });
          }
        }
      }

      let notificationSeedCount = 0;

      for (const notification of notifications) {
        const existing = await tx.notification.findFirst({
          where: {
            recipientId: notification.recipientId,
            careRequestId: notification.careRequestId,
            type: notification.type,
            createdAt: notification.createdAt,
            quoteId: notification.quoteId ?? null,
            designatedRequestId: notification.designatedRequestId ?? null,
            reviewId: notification.reviewId ?? null,
          },
        });

        if (existing) {
          continue;
        }

        await tx.notification.create({
          data: {
            recipientId: notification.recipientId,
            careRequestId: notification.careRequestId,
            quoteId: notification.quoteId ?? null,
            designatedRequestId: notification.designatedRequestId ?? null,
            reviewId: notification.reviewId ?? null,
            type: notification.type,
            message: notification.message,
            readAt: notification.unread
              ? null
              : new Date(notification.createdAt.getTime() + 10 * 60_000),
            createdAt: notification.createdAt,
          },
        });

        notificationSeedCount++;
      }

      console.log("생성 또는 연결한 팟오너:", ownerIdByIndex.size);
      console.log("생성 또는 연결한 팟트너:", sitterIdByIndex.size);
      console.log("현재 DB 사용자 수:", await tx.user.count());
      console.log("현재 DB 팟오너 프로필 수:", await tx.ownerProfile.count());
      console.log("현재 DB 팟트너 프로필 수:", await tx.sitterProfile.count());
      console.log("현재 DB 제공 서비스 수:", await tx.sitterService.count());
      console.log("현재 DB 활동 지역 수:", await tx.sitterServiceRegion.count());
      console.log("현재 DB 돌봄 요청 수:", await tx.careRequest.count());
      console.log("현재 DB 견적 수:", await tx.quote.count());
      console.log("현재 DB 지정 요청 수:", await tx.designatedRequest.count());
      console.log("현재 DB 반려 요청 수:", await tx.rejectedRequest.count());
      console.log("현재 DB 숨긴 요청 수:", await tx.ignoredRequest.count());
      console.log(
        "현재 DB 확정 견적 연결 수:",
        await tx.careRequest.count({
          where: {
            status: "MATCHED",
            confirmedQuoteId: { not: null },
          },
        }),
      );
      console.log("현재 DB 리뷰 수:", await tx.review.count());
      console.log("현재 DB 대화 수:", await tx.conversation.count());
      console.log("현재 DB 메시지 수:", await tx.message.count());
      console.log("이번 실행에서 새로 만든 알림 수:", notificationSeedCount);
      console.log("현재 DB 알림 수:", await tx.notification.count());
    },
    { timeout: 120_000 },
  );
}

main()
  .catch((error: unknown) => {
    console.error("시딩 오류:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
