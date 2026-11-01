import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import type { TransactionRunner } from "../types/db.js";
import {
  findCareRequestById,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import {
  countDesignatedRequestsByCareRequest,
  findDesignatedRequestByCareRequestAndSitter,
  findQuoteByCareRequestAndSitter,
  findSitterByIdAndRole,
  insertDesignatedRequest,
} from "../repositories/designated-request-repository.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";

// 팟오너의 지정 요청 생성
export async function createDesignatedRequest(
  ownerId: bigint,
  careRequestId: bigint,
  sitterId: bigint,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialRequest = await findCareRequestById(careRequestId);

  if (!initialRequest) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  if (initialRequest.ownerId !== ownerId) {
    throw new AppError("FORBIDDEN");
  }

  try {
    const createdDesignatedRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequestById(careRequestId, tx);

      if (!targetRequest || targetRequest.status !== "OPEN") {
        throw new AppError("ACTIVE_CARE_REQUEST_NOT_FOUND");
      }

      const wasExpired = await expireCareRequestIfPast(targetRequest, tx);

      if (wasExpired) {
        return null;
      }

      const isSitter = Boolean(await findSitterByIdAndRole(sitterId, tx));

      if (!isSitter) {
        throw new AppError("SITTER_NOT_FOUND");
      }

      const existingDesignatedRequest = await findDesignatedRequestByCareRequestAndSitter(
        careRequestId,
        sitterId,
        tx,
      );

      if (existingDesignatedRequest) {
        throw new AppError("DESIGNATED_REQUEST_ALREADY_EXISTS");
      }

      const existingQuote = await findQuoteByCareRequestAndSitter(careRequestId, sitterId, tx);

      if (existingQuote) {
        throw new AppError("SITTER_ALREADY_SENT_QUOTE");
      }

      const designatedRequestCount = await countDesignatedRequestsByCareRequest(careRequestId, tx);

      if (designatedRequestCount >= 3) {
        throw new AppError("DESIGNATED_REQUEST_LIMIT_EXCEEDED");
      }

      return insertDesignatedRequest(careRequestId, sitterId, tx);
    });

    if (!createdDesignatedRequest) {
      throw new AppError("ACTIVE_CARE_REQUEST_NOT_FOUND");
    }

    return createdDesignatedRequest;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      // 동일 트랜잭션에 다른 생성 작업이 추가 시 지정 요청의 복합 UNIQUE 제약 충돌만 중복 지정 요청 에러로 변환
      if (error.code === "P2002") {
        const constraintName = getUniqueConstraintName(error);

        if (constraintName === "DesignatedRequest_careRequestId_sitterId_key") {
          throw new AppError("DESIGNATED_REQUEST_ALREADY_EXISTS");
        }
      }

      if (error.code === "P2025") {
        const refreshedRequest = await findCareRequestById(careRequestId);

        if (refreshedRequest && refreshedRequest.status !== "OPEN") {
          throw new AppError("ACTIVE_CARE_REQUEST_NOT_FOUND");
        }
      }
    }

    throw error;
  }
}
