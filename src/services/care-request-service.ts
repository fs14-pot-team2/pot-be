import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import AppError from "../errors/app-error.js";
import type { TransactionRunner } from "../types/db.js";
import {
  findCareRequestById,
  findOpenCareRequest,
  findQuoteByCareRequestId,
  insertCareRequest,
  lockCareRequestForUpdate,
  updateOpenCareRequest,
} from "../repositories/care-request-repository.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import { toRegion } from "../utils/region.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import {
  validateUpdatedCareDates,
  type CreateCareRequestInput,
  type UpdateCareRequestInput,
} from "../validators/care-request-validator.js";

// 팟오너의 신규 돌봄 요청 생성
export async function createCareRequest(
  ownerId: bigint,
  careRequestData: CreateCareRequestInput,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  let initialOpenRequestId: bigint | null = null;

  const createInTransaction = () =>
    runTransaction(async (tx) => {
      const openRequest = await findOpenCareRequest(ownerId, tx);

      if (openRequest) {
        initialOpenRequestId = openRequest.id;

        const wasExpired = await expireCareRequestIfPast(openRequest, tx);

        if (!wasExpired) {
          throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
        }
      }

      return insertCareRequest(ownerId, careRequestData, tx);
    });

  try {
    try {
      return await createInTransaction();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
        throw error;
      }

      if (initialOpenRequestId === null) {
        throw error;
      }

      // 만료 처리 충돌 시 트랜잭션 밖에서 최초 조회한 요청과 현재 활성 요청을 재확인
      const refreshedRequest = await findCareRequestById(initialOpenRequestId);

      if (!refreshedRequest || refreshedRequest.status === "OPEN") {
        throw error;
      }

      const latestOpenRequest = await findOpenCareRequest(ownerId);

      if (latestOpenRequest) {
        throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
      }

      return await createInTransaction();
    }
  } catch (error) {
    if (getUniqueConstraintName(error) === "CareRequest_one_open_per_owner_idx") {
      throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
    }

    throw error;
  }
}

// 팟오너의 활성 돌봄 요청 존재 여부 조회
// P2025 충돌 복구 테스트에서 만료 처리 함수를 주입하기 위해 매개변수화
export async function getActiveCareRequest(
  ownerId: bigint,
  expireCareRequestIfPastFn: typeof expireCareRequestIfPast = expireCareRequestIfPast,
) {
  const initialOpenRequest = await findOpenCareRequest(ownerId);

  if (!initialOpenRequest) {
    return null;
  }

  try {
    const wasExpired = await expireCareRequestIfPastFn(initialOpenRequest);

    return wasExpired ? null : initialOpenRequest;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    // 만료 처리 충돌 시 최초 조회한 요청과 현재 활성 요청을 재확인
    const refreshedRequest = await findCareRequestById(initialOpenRequest.id);

    if (!refreshedRequest || refreshedRequest.status === "OPEN") {
      throw error;
    }

    const latestOpenRequest = await findOpenCareRequest(ownerId);

    if (!latestOpenRequest) {
      return null;
    }

    const wasExpired = await expireCareRequestIfPastFn(latestOpenRequest);

    return wasExpired ? null : latestOpenRequest;
  }
}

// 팟오너의 돌봄 요청 수정
export async function updateCareRequest(
  ownerId: bigint,
  careRequestId: bigint,
  careRequestData: UpdateCareRequestInput,
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
    const updatedRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequestById(careRequestId, tx);

      if (!targetRequest || targetRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_STATUS_NOT_EDITABLE");
      }

      const wasExpired = await expireCareRequestIfPast(targetRequest, tx);

      if (wasExpired) {
        return null;
      }

      const hasReceivedQuote = Boolean(await findQuoteByCareRequestId(careRequestId, tx));

      if (hasReceivedQuote) {
        throw new AppError("CARE_REQUEST_EDIT_NOT_ALLOWED");
      }

      if (careRequestData.startDate !== undefined || careRequestData.endDate !== undefined) {
        // 날짜가 전달된 경우에만 유효성 검증
        const startDate =
          careRequestData.startDate ?? targetRequest.startDate.toISOString().slice(0, 10);

        const endDate = careRequestData.endDate ?? targetRequest.endDate.toISOString().slice(0, 10);

        validateUpdatedCareDates(startDate, endDate, careRequestData.startDate !== undefined);
      }

      const region =
        careRequestData.sido !== undefined ? toRegion(careRequestData.sido) : undefined;

      return updateOpenCareRequest(
        careRequestId,
        ownerId,
        {
          ...careRequestData,
          ...(region !== undefined && { region }),
        },
        tx,
      );
    });

    if (!updatedRequest) {
      throw new AppError("CARE_REQUEST_STATUS_NOT_EDITABLE");
    }

    return updatedRequest;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    const refreshedRequest = await findCareRequestById(careRequestId);

    if (refreshedRequest && refreshedRequest.status !== "OPEN") {
      throw new AppError("CARE_REQUEST_STATUS_NOT_EDITABLE");
    }

    throw error;
  }
}
