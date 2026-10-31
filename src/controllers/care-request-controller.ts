import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import {
  createCareRequest,
  getActiveCareRequest,
  updateCareRequest,
} from "../services/care-request-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";
import {
  validateCreateCareRequest,
  validateUpdateCareRequest,
} from "../validators/care-request-validator.js";

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

// 팟오너의 활성 돌봄 요청 조회
export async function getActiveCareRequestController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const ownerId = req.user.id;
  const activeCareRequest = await getActiveCareRequest(ownerId);

  if (!activeCareRequest) {
    res.status(200).json({
      hasActiveCareRequest: false,
      careRequest: null,
    });
    return;
  }

  const careRequestResponse = {
    id: activeCareRequest.id,
    serviceType: activeCareRequest.serviceType,
    startDate: activeCareRequest.startDate.toISOString().slice(0, 10),
    endDate: activeCareRequest.endDate.toISOString().slice(0, 10),
    zonecode: activeCareRequest.zonecode,
    address: activeCareRequest.address,
    detailAddress: activeCareRequest.detailAddress,
    sido: activeCareRequest.sido,
    sigungu: activeCareRequest.sigungu,
    bname: activeCareRequest.bname,
  };

  res.status(200).json(
    serializeBigInt({
      hasActiveCareRequest: true,
      careRequest: careRequestResponse,
    }),
  );
}

// 팟오너의 돌봄 요청 수정
export async function updateCareRequestController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const ownerId = req.user.id;
  const careRequestId = parseBigId(req.params.careRequestId);

  if (careRequestId === null) {
    throw new AppError("INVALID_ID");
  }

  const careRequestData = validateUpdateCareRequest(req.body);
  const updatedCareRequest = await updateCareRequest(ownerId, careRequestId, careRequestData);

  const careRequestResponse = {
    id: updatedCareRequest.id,
    serviceType: updatedCareRequest.serviceType,
    startDate: updatedCareRequest.startDate.toISOString().slice(0, 10),
    endDate: updatedCareRequest.endDate.toISOString().slice(0, 10),
    zonecode: updatedCareRequest.zonecode,
    address: updatedCareRequest.address,
    detailAddress: updatedCareRequest.detailAddress,
    sido: updatedCareRequest.sido,
    sigungu: updatedCareRequest.sigungu,
    bname: updatedCareRequest.bname,
    region: updatedCareRequest.region,
    status: updatedCareRequest.status,
    updatedAt: updatedCareRequest.updatedAt,
  };

  res.status(200).json(serializeBigInt(careRequestResponse));
}
