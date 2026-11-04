import { prisma } from "../config/prisma.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import AppError from "../errors/app-error.js";
import {
  findCareRequest,
  findSitterProfileWithRegions,
  lockCareRequestForUpdate,
} from "../repositories/care-request-repository.js";
import {
  findDesignatedRequestByCareRequestAndSitter,
  findQuoteByCareRequestAndSitter,
} from "../repositories/designated-request-repository.js";
import {
  findIgnoredRequestByCareRequestAndSitter,
  insertIgnoredRequest,
} from "../repositories/ignored-request-repository.js";
import type { TransactionRunner } from "../types/db.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";

// 팟트너의 공개 돌봄 요청 숨김 처리
export async function ignoreCareRequest(
  sitterId: bigint,
  careRequestId: bigint,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  try {
    const ignoredRequest = await runTransaction(async (tx) => {
      // 서비스 지역은 공개 요청 수신 자격을 결정하므로, 지역 변경과 숨김 처리의 순차적 실행을 보장하기 위해 동일한 프로필 행을 잠금
      await tx.$queryRaw`
        SELECT "id"
        FROM "SitterProfile"
        WHERE "userId" = ${sitterId}
        FOR UPDATE
      `;

      await lockCareRequestForUpdate(careRequestId, tx);

      const sitterProfile = await findSitterProfileWithRegions(sitterId, tx);

      if (!sitterProfile) {
        throw new AppError("FORBIDDEN");
      }

      const sitterRegions = sitterProfile.sitterServiceRegions.map(({ region }) => region);

      const careRequest = await findCareRequest(careRequestId, tx);

      if (!careRequest) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      if (careRequest.status !== CareRequestStatus.OPEN) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
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
        throw new AppError("REQUEST_IGNORE_NOT_ALLOWED");
      }

      if (!sitterRegions.includes(careRequest.region)) {
        throw new AppError("FORBIDDEN");
      }

      const existingIgnoredRequest = await findIgnoredRequestByCareRequestAndSitter(
        careRequestId,
        sitterId,
        tx,
      );

      if (existingIgnoredRequest) {
        throw new AppError("REQUEST_ALREADY_IGNORED");
      }

      const existingQuote = await findQuoteByCareRequestAndSitter(careRequestId, sitterId, tx);
      if (existingQuote) {
        throw new AppError("QUOTE_ALREADY_EXISTS");
      }

      return insertIgnoredRequest(careRequestId, sitterId, tx);
    });

    if (!ignoredRequest) {
      throw new AppError("CARE_REQUEST_NOT_FOUND");
    }

    return ignoredRequest;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "P2002" &&
      getUniqueConstraintName(error) === "IgnoredRequest_careRequestId_sitterId_key"
    ) {
      throw new AppError("REQUEST_ALREADY_IGNORED");
    }

    throw error;
  }
}
