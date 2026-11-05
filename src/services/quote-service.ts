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
import { countGeneralQuotesByCareRequest, insertQuote } from "../repositories/quote-repository.js";
import type { TransactionRunner } from "../types/db.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
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
