import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import { ignoreCareRequest } from "../services/ignored-request-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";

// 팟트너의 공개 돌봄 요청 숨김 처리
export async function ignoreCareRequestController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const careRequestId = parseBigId(req.params.careRequestId);

  if (careRequestId === null) {
    throw new AppError("INVALID_ID");
  }

  const ignoredRequest = await ignoreCareRequest(sitterId, careRequestId);

  const ignoredRequestResponse = {
    id: ignoredRequest.id,
    careRequestId: ignoredRequest.careRequestId,
    createdAt: ignoredRequest.createdAt,
  };

  res.status(201).json(serializeBigInt(ignoredRequestResponse));
}
