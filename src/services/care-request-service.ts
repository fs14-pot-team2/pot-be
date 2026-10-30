import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  findCareRequestById,
  findOpenCareRequest,
  insertCareRequest,
} from "../repositories/care-request-repository.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import type { CreateCareRequestInput } from "../validators/care-request-validator.js";

// 팟오너의 신규 돌봄 요청 생성
export async function createCareRequest(ownerId: bigint, careRequestData: CreateCareRequestInput) {
  let initialOpenRequestId: bigint | null = null;

  const createInTransaction = () =>
    prisma.$transaction(async (tx) => {
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
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
    }

    throw error;
  }
}

// 팟오너의 활성 돌봄 요청 존재 여부 조회
export async function getActiveCareRequest(ownerId: bigint) {
  const initialOpenRequest = await findOpenCareRequest(ownerId);

  if (!initialOpenRequest) {
    return null;
  }

  try {
    const wasExpired = await expireCareRequestIfPast(initialOpenRequest);

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

    const wasExpired = await expireCareRequestIfPast(latestOpenRequest);

    return wasExpired ? null : latestOpenRequest;
  }
}
