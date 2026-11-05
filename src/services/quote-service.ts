import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  findCareRequest,
  findSitterProfileWithRegions,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import {
  findDesignatedRequestByCareRequestAndSitter,
  findQuoteByCareRequestAndSitter,
  findRejectedRequestByDesignatedRequestId,
} from "../repositories/designated-request-repository.js";
import { findIgnoredRequestByCareRequestAndSitter } from "../repositories/ignored-request-repository.js";
import { lockSitterProfileByUserId } from "../repositories/profile-repository.js";
import {
  countGeneralQuotesByCareRequest,
  findQuote,
  insertQuote,
  updateQuote,
} from "../repositories/quote-repository.js";
import type { TransactionRunner } from "../types/db.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import type { CreateQuoteInput } from "../validators/quote-validator.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";

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
