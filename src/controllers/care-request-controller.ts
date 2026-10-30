import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import { createCareRequest } from "../services/care-request-service.js";
import { serializeBigInt } from "../utils/bigint.js";
import { validateCreateCareRequest } from "../validators/care-request-validator.js";

// 돌봄 요청 생성
export async function createCareRequestController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const userId = req.user.id;

  const careRequestData = validateCreateCareRequest(req.body);
  const createdCareRequest = await createCareRequest(userId, careRequestData);

  const careRequestResponse = {
    id: createdCareRequest.id,
    serviceType: createdCareRequest.serviceType,
    startDate: createdCareRequest.startDate.toISOString().slice(0, 10),
    endDate: createdCareRequest.endDate.toISOString().slice(0, 10),
    zonecode: createdCareRequest.zonecode,
    address: createdCareRequest.address,
    detailAddress: createdCareRequest.detailAddress,
    sido: createdCareRequest.sido,
    sigungu: createdCareRequest.sigungu,
    bname: createdCareRequest.bname,
    region: createdCareRequest.region,
    status: createdCareRequest.status,
    createdAt: createdCareRequest.createdAt,
  };

  res.status(201).json(serializeBigInt(careRequestResponse));
}
