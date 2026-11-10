import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import {
  confirmCareRequest,
  findCareRequest,
  findSitterProfileIdByUserId,
  findSitterProfileWithRegions,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import {
  findDesignatedRequestByCareRequestAndSitter,
  findQuoteByCareRequestAndSitter,
  findRejectedRequestByDesignatedRequestId,
} from "../repositories/designated-request-repository.js";
import {
  countGeneralQuotesByCareRequest,
  countSentQuotes,
  findQuote,
  findQuoteDetail,
  findQuoteForConfirmation,
  findSentQuotes,
  insertQuote,
  updateQuote,
} from "../repositories/quote-repository.js";
import { findIgnoredRequestByCareRequestAndSitter } from "../repositories/ignored-request-repository.js";
import { lockSitterProfileByUserId } from "../repositories/profile-repository.js";
import type { TransactionRunner } from "../types/db.js";
import type { AuthUser } from "../types/auth.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import { serializeDate } from "../utils/serialize-date.js";
import type { CreateQuoteInput } from "../validators/quote-validator.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import { getSitterAggregates } from "./sitter-aggregate-service.js";

// 팟트너의 돌봄 요청에 대한 견적 생성
export async function createQuote(
  sitterId: bigint,
  careRequestId: bigint,
  price: number,
  comment: string,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  try {
    const createdQuote = await runTransaction(async (tx) => {
      await lockSitterProfileByUserId(sitterId, tx);
      await lockCareRequestForUpdate(careRequestId, tx);

      const sitterProfile = await findSitterProfileWithRegions(sitterId, tx);

      if (!sitterProfile) {
        throw new AppError("FORBIDDEN");
      }

      const careRequest = await findCareRequest(careRequestId, tx);

      if (!careRequest) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      if (careRequest.status !== "OPEN") {
        throw new AppError("QUOTE_EDIT_NOT_ALLOWED");
      }

      const wasExpired = await expireCareRequestIfPast(careRequest, tx);

      if (wasExpired) {
        return null;
      }

      const designatedRequest = await findDesignatedRequestByCareRequestAndSitter(
        careRequestId,
        sitterId,
        tx,
      );

      if (designatedRequest) {
        const rejectedRequest = await findRejectedRequestByDesignatedRequestId(
          designatedRequest.id,
          tx,
        );

        if (rejectedRequest) {
          throw new AppError("DESIGNATED_REQUEST_NOT_FOUND");
        }
      } else {
        const sitterRegions = sitterProfile.sitterServiceRegions.map(({ region }) => region);

        if (!sitterRegions.includes(careRequest.region)) {
          throw new AppError("CARE_REQUEST_NOT_FOUND");
        }

        const ignoredRequest = await findIgnoredRequestByCareRequestAndSitter(
          careRequestId,
          sitterId,
          tx,
        );

        if (ignoredRequest) {
          throw new AppError("CARE_REQUEST_NOT_FOUND");
        }
      }

      const existingQuote = await findQuoteByCareRequestAndSitter(careRequestId, sitterId, tx);

      if (existingQuote) {
        throw new AppError("QUOTE_ALREADY_EXISTS");
      }

      const quoteType = designatedRequest ? "DESIGNATED" : "GENERAL";

      if (quoteType === "GENERAL") {
        const generalQuoteCount = await countGeneralQuotesByCareRequest(careRequestId, tx);

        if (generalQuoteCount >= 5) {
          throw new AppError("GENERAL_QUOTE_LIMIT_EXCEEDED");
        }
      }

      return insertQuote(careRequestId, sitterId, quoteType, price, comment, tx);
    });

    if (!createdQuote) {
      throw new AppError("QUOTE_EDIT_NOT_ALLOWED");
    }

    return createdQuote;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (
        error.code === "P2002" &&
        getUniqueConstraintName(error) === "Quote_careRequestId_sitterId_key"
      ) {
        throw new AppError("QUOTE_ALREADY_EXISTS");
      }

      if (error.code === "P2025") {
        const refreshedRequest = await findCareRequest(careRequestId);

        if (refreshedRequest && refreshedRequest.status !== "OPEN") {
          throw new AppError("QUOTE_EDIT_NOT_ALLOWED");
        }
      }
    }

    throw error;
  }
}

// 팟트너의 기존 견적 수정
export async function updateQuoteService(
  sitterId: bigint,
  quoteId: bigint,
  quoteData: Partial<CreateQuoteInput>,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialQuote = await findQuote(quoteId);

  if (!initialQuote) {
    throw new AppError("QUOTE_NOT_FOUND");
  }

  if (initialQuote.sitterId !== sitterId) {
    throw new AppError("FORBIDDEN");
  }

  const careRequestId = initialQuote.careRequestId;

  try {
    const updatedQuote = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const careRequest = await findCareRequest(careRequestId, tx);

      if (!careRequest) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      // 견적 확정 시 CareRequest.status와 confirmedQuoteId는 동일 트랜잭션에서 변경하므로
      // 견적 수정 가능 여부는 OPEN 상태로 판단하고 확정 ID를 중복 검증하지 않음
      if (careRequest.status !== "OPEN") {
        throw new AppError("QUOTE_EDIT_NOT_ALLOWED");
      }

      const wasExpired = await expireCareRequestIfPast(careRequest, tx);

      if (wasExpired) {
        return null;
      }

      const targetQuote = await findQuote(quoteId, tx);

      if (!targetQuote) {
        throw new AppError("QUOTE_NOT_FOUND");
      }

      if (targetQuote.sitterId !== sitterId) {
        throw new AppError("FORBIDDEN");
      }

      return updateQuote(quoteId, quoteData, tx);
    });

    if (!updatedQuote) {
      throw new AppError("QUOTE_EDIT_NOT_ALLOWED");
    }

    return updatedQuote;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    const refreshedRequest = await findCareRequest(careRequestId);

    if (refreshedRequest && refreshedRequest.status !== "OPEN") {
      throw new AppError("QUOTE_EDIT_NOT_ALLOWED");
    }

    throw error;
  }
}

// 팟오너의 견적 확정
export async function confirmQuoteService(
  ownerId: bigint,
  quoteId: bigint,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialQuote = await findQuote(quoteId);

  if (!initialQuote) {
    throw new AppError("QUOTE_NOT_FOUND");
  }

  const careRequestId = initialQuote.careRequestId;

  try {
    const confirmedQuote = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const careRequest = await findCareRequest(careRequestId, tx);

      if (!careRequest) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      if (careRequest.ownerId !== ownerId) {
        throw new AppError("FORBIDDEN");
      }

      if (careRequest.status === "MATCHED") {
        if (careRequest.confirmedQuoteId === quoteId) {
          throw new AppError("QUOTE_ALREADY_CONFIRMED");
        }

        throw new AppError("CARE_REQUEST_ALREADY_MATCHED");
      }

      if (careRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      const wasExpired = await expireCareRequestIfPast(careRequest, tx);

      if (wasExpired) {
        return null;
      }

      const targetQuote = await findQuoteForConfirmation(quoteId, tx);

      if (!targetQuote || targetQuote.careRequestId !== careRequestId) {
        throw new AppError("QUOTE_NOT_FOUND");
      }

      const confirmedRequest = await confirmCareRequest(careRequestId, ownerId, quoteId, tx);

      return {
        quote: {
          id: targetQuote.id,
          careRequestId: targetQuote.careRequestId,
          sitterId: targetQuote.sitterId,
          type: targetQuote.type,
          price: targetQuote.price,
          comment: targetQuote.comment,
        },
        careRequest: {
          id: confirmedRequest.id,
          status: confirmedRequest.status,
          confirmedQuoteId: confirmedRequest.confirmedQuoteId,
          updatedAt: confirmedRequest.updatedAt,
        },
      };
    });

    if (!confirmedQuote) {
      throw new AppError("CARE_REQUEST_NOT_FOUND");
    }

    return confirmedQuote;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    const refreshedRequest = await findCareRequest(careRequestId);

    if (refreshedRequest && refreshedRequest.status === "MATCHED") {
      if (refreshedRequest.confirmedQuoteId === quoteId) {
        throw new AppError("QUOTE_ALREADY_CONFIRMED");
      }

      throw new AppError("CARE_REQUEST_ALREADY_MATCHED");
    }

    if (refreshedRequest && refreshedRequest.status !== "OPEN") {
      throw new AppError("CARE_REQUEST_NOT_FOUND");
    }

    throw error;
  }
}

/*
 * 견적 조회 및 주소 공개 조건
 * - OPEN: 요청자 본인(전체 주소), 서비스 지역에 해당하거나 지정 요청을 받은 팟트너(일부 주소)
 * - MATCHED: 요청자 본인(전체 주소), 해당 요청 견적 제출자(최종 매칭 시 전체 주소, 미매칭 시 일부 주소)
 * - EXPIRED: 요청자 본인(전체 주소), 해당 요청 견적 제출자(일부 주소)
 * - CANCELED: 모든 사용자 조회 불가
 * - 전체 주소: sido, sigungu, bname, zonecode, address, detailAddress
 * - 일부 주소: sido, sigungu, bname만 공개 / zonecode, address, detailAddress는 null
 */
// 견적 상세 조회 및 접근 권한에 따른 주소 공개
export async function getQuoteDetail(quoteId: bigint, user: AuthUser) {
  const quote = await findQuoteDetail(quoteId);

  if (!quote) {
    throw new AppError("QUOTE_NOT_FOUND");
  }

  const careRequest = quote.careRequest;

  if (careRequest.status === "CANCELED") {
    throw new AppError("QUOTE_ACCESS_FORBIDDEN");
  }

  let canViewFullAddress = false;

  if (user.role === "OWNER") {
    if (careRequest.ownerId !== user.id) {
      throw new AppError("QUOTE_ACCESS_FORBIDDEN");
    }

    canViewFullAddress = true;
  } else {
    if (careRequest.status === "OPEN") {
      const isDesignatedSitter = careRequest.designatedRequests.some(
        (designatedRequest) => designatedRequest.sitterId === user.id,
      );

      const sitterProfile = await findSitterProfileWithRegions(user.id);
      const isServiceRegion =
        sitterProfile?.sitterServiceRegions.some(({ region }) => region === careRequest.region) ??
        false;

      if (!isDesignatedSitter && !isServiceRegion) {
        throw new AppError("QUOTE_ACCESS_FORBIDDEN");
      }
    } else {
      if (quote.sitterId !== user.id) {
        throw new AppError("QUOTE_ACCESS_FORBIDDEN");
      }

      canViewFullAddress =
        careRequest.status === "MATCHED" && careRequest.confirmedQuoteId === quote.id;
    }
  }

  const designatedRequestId =
    careRequest.designatedRequests.find(
      (designatedRequest) => designatedRequest.sitterId === quote.sitterId,
    )?.id ?? null;

  const sitterProfile = quote.sitter.sitterProfile;

  if (!sitterProfile) {
    throw new AppError("SITTER_PROFILE_INCONSISTENT");
  }

  const sitterAggregates = await getSitterAggregates([quote.sitterId]);
  const sitterAggregate = sitterAggregates.get(quote.sitterId);

  return {
    quote: {
      id: quote.id,
      price: quote.price,
      comment: quote.comment,
      createdAt: quote.createdAt,
    },
    designatedRequestId,
    careRequest: {
      id: careRequest.id,
      status: careRequest.status,
      confirmedQuoteId: careRequest.confirmedQuoteId,
      createdAt: careRequest.createdAt,
      serviceType: careRequest.serviceType,
      startDate: serializeDate(careRequest.startDate),
      endDate: serializeDate(careRequest.endDate),
      sido: careRequest.sido,
      sigungu: careRequest.sigungu,
      bname: careRequest.bname,
      zonecode: canViewFullAddress ? careRequest.zonecode : null,
      address: canViewFullAddress ? careRequest.address : null,
      detailAddress: canViewFullAddress ? careRequest.detailAddress : null,
    },
    owner: {
      nickname: careRequest.owner.nickname,
    },
    sitter: {
      id: quote.sitter.id,
      nickname: quote.sitter.nickname,
      profileImageUrl: sitterProfile.profileImageUrl,
      gender: sitterProfile.gender,
      shortIntroduction: sitterProfile.shortIntroduction,
      averageRating: sitterAggregate?.averageRating ?? 0,
      reviewCount: sitterAggregate?.reviewCount ?? 0,
      confirmedQuoteCount: sitterAggregate?.confirmedQuoteCount ?? 0,
    },
  };
}

// 팟트너가 보낸 견적 목록 조회
export async function getSentQuotes(
  sitterId: bigint,
  page: number,
  pageSize: number,
  confirmedOnly: boolean,
) {
  const sitterProfile = await findSitterProfileIdByUserId(sitterId);

  if (!sitterProfile) {
    throw new AppError("FORBIDDEN");
  }

  const skip = (page - 1) * pageSize;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const openStatuses = [CareRequestStatus.OPEN];
  const nonOpenStatuses = [CareRequestStatus.MATCHED, CareRequestStatus.EXPIRED];

  const [openCount, nonOpenCount] = await Promise.all([
    countSentQuotes(sitterId, openStatuses, confirmedOnly),
    countSentQuotes(sitterId, nonOpenStatuses, confirmedOnly),
  ]);

  const totalCount = openCount + nonOpenCount;

  if (!Number.isSafeInteger(totalCount)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  // skip <= openCount ? skip : openCount
  const openSkip = Math.min(skip, openCount);

  // pageSize <= openCount - openSkip ? pageSize : openCount - openSkip
  const openTake = Math.min(pageSize, openCount - openSkip);

  // skip - openCount >= 0 ? skip - openCount : 0
  const nonOpenSkip = Math.max(0, skip - openCount);

  // nonOpenCount - nonOpenSkip >= 0 ? nonOpenCount - nonOpenSkip : 0
  // pageSize - openTake <= (위에서 선택한 값) ? pageSize - openTake : (위에서 선택한 값)
  const nonOpenTake = Math.min(pageSize - openTake, Math.max(0, nonOpenCount - nonOpenSkip));

  const [openQuotes, nonOpenQuotes] = await Promise.all([
    openTake > 0
      ? findSentQuotes(sitterId, openStatuses, confirmedOnly, openSkip, openTake)
      : Promise.resolve([]),
    nonOpenTake > 0
      ? findSentQuotes(sitterId, nonOpenStatuses, confirmedOnly, nonOpenSkip, nonOpenTake)
      : Promise.resolve([]),
  ]);

  const items = [...openQuotes, ...nonOpenQuotes].map((quote) => ({
    quote: {
      id: quote.id,
      price: quote.price,
      comment: quote.comment,
      createdAt: quote.createdAt,
    },
    designatedRequestId: quote.careRequest.designatedRequests[0]?.id ?? null,
    careRequest: {
      id: quote.careRequest.id,
      status: quote.careRequest.status,
      serviceType: quote.careRequest.serviceType,
      startDate: serializeDate(quote.careRequest.startDate),
      endDate: serializeDate(quote.careRequest.endDate),
      sido: quote.careRequest.sido,
      sigungu: quote.careRequest.sigungu,
      bname: quote.careRequest.bname,
      confirmedQuoteId: quote.careRequest.confirmedQuoteId,
    },
    owner: {
      nickname: quote.careRequest.owner.nickname,
    },
  }));

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages,
  };
}
