import { prisma } from "../config/prisma.js";
import AppError from "../errors/app-error.js";
import { findOpenCareRequest, insertCareRequest } from "../repositories/care-request-repository.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import type { CreateCareRequestInput } from "../validators/care-request-validator.js";

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
