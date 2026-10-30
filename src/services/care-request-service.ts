import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import {
  findCareRequestById,
  findOpenCareRequest,
  insertCareRequest,
} from "../repositories/care-request-repository.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import type { CreateCareRequestInput } from "../validators/care-request-validator.js";

// 팟오너의 (활성) 돌봄 요청 생성
export async function createCareRequest(ownerId: bigint, careRequestData: CreateCareRequestInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const openRequest = await findOpenCareRequest(ownerId, tx);

      if (openRequest) {
        const wasExpired = await expireCareRequestIfPast(openRequest, tx);

        if (!wasExpired) {
          throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
        }
      }

      return insertCareRequest(ownerId, careRequestData, tx);
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
    }

    throw error;
  }
}

// 팟오너의 활성 돌봄 요청 조회
export async function getActiveCareRequest(ownerId: bigint) {
  const openRequest = await findOpenCareRequest(ownerId);

  if (!openRequest) {
    return null;
  }

  try {
    const wasExpired = await expireCareRequestIfPast(openRequest);

    return wasExpired ? null : openRequest;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    // 동시 상태 변경으로 인한 충돌 시 기존 요청의 상태와 현재 활성 요청을 재확인
    const refreshedRequest = await findCareRequestById(openRequest.id);

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
