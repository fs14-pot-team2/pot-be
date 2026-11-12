import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import type { TransactionRunner } from "../types/db.js";
import {
  findCareRequest,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import {
  countDesignatedRequestsByCareRequest,
  countRejectedRequestsBySitter,
  findDesignatedRequestByCareRequestAndSitter,
  findDesignatedRequest,
  findRejectedRequest,
  findRejectedRequestByDesignatedRequestId,
  findRejectedRequestsBySitter,
  insertDesignatedRequest,
  insertRejectedRequest,
} from "../repositories/designated-request-repository.js";
import { insertNotification } from "../repositories/notification-repository.js";
import { findSitterProfileIdByUserId } from "../repositories/profile-repository.js";
import { findQuoteByCareRequestAndSitter } from "../repositories/quote-repository.js";
import { findSitterByIdAndRole, findUserById } from "../repositories/user-repository.js";
import { createNotificationMessage } from "../utils/notification-message.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";

// 팟오너의 지정 요청 생성
export async function createDesignatedRequest(
  ownerId: bigint,
  careRequestId: bigint,
  sitterId: bigint,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialRequest = await findCareRequest(careRequestId);

  if (!initialRequest) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  if (initialRequest.ownerId !== ownerId) {
    throw new AppError("FORBIDDEN");
  }

  try {
    const createdDesignatedRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequest(careRequestId, tx);

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

      const createdDesignatedRequest = await insertDesignatedRequest(careRequestId, sitterId, tx);

      const owner = await findUserById(ownerId, tx);

      if (!owner) {
        throw new AppError("INTERNAL_SERVER_ERROR");
      }

      await insertNotification(
        {
          recipientId: sitterId,
          careRequestId,
          designatedRequestId: createdDesignatedRequest.id,
          type: "DESIGNATED_REQUEST_RECEIVED",
          message: createNotificationMessage({
            type: "DESIGNATED_REQUEST_RECEIVED",
            nickname: owner.nickname,
          }),
        },
        tx,
      );

      return createdDesignatedRequest;
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
        const refreshedRequest = await findCareRequest(careRequestId);

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
  const initialDesignatedRequest = await findDesignatedRequest(designatedRequestId);

  if (!initialDesignatedRequest) {
    throw new AppError("DESIGNATED_REQUEST_NOT_FOUND");
  }

  if (initialDesignatedRequest.sitterId !== sitterId) {
    throw new AppError("FORBIDDEN");
  }

  const sitterProfile = await findSitterProfileIdByUserId(sitterId);

  if (!sitterProfile) {
    throw new AppError("FORBIDDEN");
  }

  const careRequestId = initialDesignatedRequest.careRequestId;

  try {
    const createdRejectedRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequest(careRequestId, tx);

      if (!targetRequest || targetRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      const wasExpired = await expireCareRequestIfPast(targetRequest, tx);

      if (wasExpired) {
        return null;
      }

      const targetDesignatedRequest = await findDesignatedRequest(designatedRequestId, tx);

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

      const createdRejectedRequest = await insertRejectedRequest(designatedRequestId, reason, tx);

      const sitter = await findUserById(sitterId, tx);

      if (!sitter) {
        throw new AppError("INTERNAL_SERVER_ERROR");
      }

      await insertNotification(
        {
          recipientId: targetRequest.ownerId,
          careRequestId,
          designatedRequestId,
          type: "DESIGNATED_REQUEST_REJECTED",
          message: createNotificationMessage({
            type: "DESIGNATED_REQUEST_REJECTED",
            nickname: sitter.nickname,
          }),
        },
        tx,
      );

      return createdRejectedRequest;
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
      const refreshedRequest = await findCareRequest(careRequestId);

      if (refreshedRequest && refreshedRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }
    }

    throw error;
  }
}

// 팟트너의 반려 요청 이력 목록 조회
export async function getRejectedRequestsBySitter(
  sitterId: bigint,
  page: number,
  pageSize: number,
) {
  const sitterProfile = await findSitterProfileIdByUserId(sitterId);

  if (!sitterProfile) {
    throw new AppError("FORBIDDEN");
  }

  const skip = (page - 1) * pageSize;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const [totalCount, items] = await Promise.all([
    countRejectedRequestsBySitter(sitterId),
    findRejectedRequestsBySitter(sitterId, skip, pageSize),
  ]);

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

// 팟오너의 반려 사유 조회
export async function getRejectedRequestReason(ownerId: bigint, rejectedRequestId: bigint) {
  const rejectedRequest = await findRejectedRequest(rejectedRequestId);

  if (!rejectedRequest) {
    throw new AppError("REJECTED_REQUEST_NOT_FOUND");
  }

  const careRequest = rejectedRequest.designatedRequest.careRequest;

  if (careRequest.ownerId !== ownerId) {
    throw new AppError("FORBIDDEN");
  }

  // 정책에 따라 팟오너의 취소한 돌봄 요청에 대한 모든 이력을 확인할 수 없다.
  if (careRequest.status === "CANCELED") {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  return rejectedRequest.reason;
}
