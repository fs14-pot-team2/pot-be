import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import { createDesignatedRequest } from "../services/designated-request-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";
import { validateCreateDesignatedRequest } from "../validators/designated-request-validator.js";

// 팟오너의 지정 요청 생성
export async function createDesignatedRequestController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const ownerId = req.user.id;
  const careRequestId = parseBigId(req.params.careRequestId);

  if (careRequestId === null) {
    throw new AppError("INVALID_ID");
  }

  const sitterId = validateCreateDesignatedRequest(req.body);

  const createdDesignatedRequest = await createDesignatedRequest(ownerId, careRequestId, sitterId);

  const designatedRequestResponse = {
    id: createdDesignatedRequest.id,
    careRequestId: createdDesignatedRequest.careRequestId,
    sitterId: createdDesignatedRequest.sitterId,
    createdAt: createdDesignatedRequest.createdAt,
  };

  res.status(201).json(serializeBigInt(designatedRequestResponse));
}
