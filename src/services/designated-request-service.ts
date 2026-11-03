import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import type { TransactionRunner } from "../types/db.js";
import {
  findCareRequestById,
  findSitterProfileWithRegions,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import {
  countDesignatedRequestsByCareRequest,
  findDesignatedRequestByCareRequestAndSitter,
  findDesignatedRequestById,
  findQuoteByCareRequestAndSitter,
  findRejectedRequestByDesignatedRequestId,
  findSitterByIdAndRole,
  insertDesignatedRequest,
  insertRejectedRequest,
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

// 팟트너의 지정 요청 반려
export async function rejectDesignatedRequest(
  sitterId: bigint,
  designatedRequestId: bigint,
  reason: string,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialDesignatedRequest = await findDesignatedRequestById(designatedRequestId);

  if (!initialDesignatedRequest) {
    throw new AppError("DESIGNATED_REQUEST_NOT_FOUND");
  }

  if (initialDesignatedRequest.sitterId !== sitterId) {
    throw new AppError("FORBIDDEN");
  }

  const sitterProfile = await findSitterProfileWithRegions(sitterId);

  if (!sitterProfile) {
    throw new AppError("FORBIDDEN");
  }

  const careRequestId = initialDesignatedRequest.careRequestId;

  try {
    const createdRejectedRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequestById(careRequestId, tx);

      if (!targetRequest || targetRequest.status !== CareRequestStatus.OPEN) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      const wasExpired = await expireCareRequestIfPast(targetRequest, tx);

      if (wasExpired) {
        return null;
      }

      const targetDesignatedRequest = await findDesignatedRequestById(designatedRequestId, tx);

      if (!targetDesignatedRequest) {
        throw new AppError("DESIGNATED_REQUEST_NOT_FOUND");
      }

      if (targetDesignatedRequest.sitterId !== sitterId) {
        throw new AppError("FORBIDDEN");
      }

      const existingRejectedRequest = await findRejectedRequestByDesignatedRequestId(
        designatedRequestId,
        tx,
      );

      if (existingRejectedRequest) {
        throw new AppError("DESIGNATED_REQUEST_ALREADY_REJECTED");
      }

      const existingQuote = await findQuoteByCareRequestAndSitter(careRequestId, sitterId, tx);

      if (existingQuote) {
        throw new AppError("QUOTE_ALREADY_EXISTS");
      }

      return insertRejectedRequest(designatedRequestId, reason, tx);
    });

    if (!createdRejectedRequest) {
      throw new AppError("CARE_REQUEST_NOT_FOUND");
    }

    return createdRejectedRequest;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "P2002" &&
      getUniqueConstraintName(error) === "RejectedRequest_designatedRequestId_key"
    ) {
      throw new AppError("DESIGNATED_REQUEST_ALREADY_REJECTED");
    }

    if (error instanceof Error && "code" in error && error.code === "P2025") {
      const refreshedRequest = await findCareRequestById(careRequestId);

      if (refreshedRequest && refreshedRequest.status !== CareRequestStatus.OPEN) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }
    }

    throw error;
  }
}
