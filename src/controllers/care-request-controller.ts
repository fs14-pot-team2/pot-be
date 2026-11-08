import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import {
  createCareRequest,
  getActiveCareRequest,
  getOpenCareRequestQuotes,
  getReceivedCareRequests,
  updateCareRequest,
} from "../services/care-request-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";
import { serializeDate } from "../utils/serialize-date.js";
import {
  validateCreateCareRequest,
  validateReceivedCareRequestsQuery,
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
    startDate: serializeDate(createdCareRequest.startDate),
    endDate: serializeDate(createdCareRequest.endDate),
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
    startDate: serializeDate(activeCareRequest.startDate),
    endDate: serializeDate(activeCareRequest.endDate),
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
    startDate: serializeDate(updatedCareRequest.startDate),
    endDate: serializeDate(updatedCareRequest.endDate),
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

// 팟트너의 받은 돌봄 요청 목록 조회
export async function getReceivedCareRequestsController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const query = validateReceivedCareRequestsQuery(req.query);
  const result = await getReceivedCareRequests(sitterId, query);

  const items = result.items.map((item) => ({
    careRequest: {
      id: item.id,
      createdAt: item.createdAt,
      serviceType: item.serviceType,
      startDate: serializeDate(item.startDate),
      endDate: serializeDate(item.endDate),
      sido: item.sido,
      sigungu: item.sigungu,
      bname: item.bname,
      owner: {
        nickname: item.owner.nickname,
      },
    },
    designatedRequestId: item.designatedRequests[0]?.id ?? null,
  }));

  res.status(200).json(
    serializeBigInt({
      items,
      availableRegions: result.availableRegions,
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
    }),
  );
}

// 팟오너의 요청한 견적 현황 조회
export async function getOpenCareRequestQuotesController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const ownerId = req.user.id;
  const careRequestQuoteOverview = await getOpenCareRequestQuotes(ownerId);

  res.status(200).json(serializeBigInt(careRequestQuoteOverview));
}
