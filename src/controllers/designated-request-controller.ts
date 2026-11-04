import type { Request, Response } from "express";
import AppError from "../errors/app-error.js";
import {
  createDesignatedRequest,
  getRejectedRequestsBySitter,
  rejectDesignatedRequest,
} from "../services/designated-request-service.js";
import { parseBigId, serializeBigInt } from "../utils/bigint.js";
import {
  validateCreateDesignatedRequest,
  validateRejectDesignatedRequest,
} from "../validators/designated-request-validator.js";
import { serializeDate } from "../utils/serialize-date.js";
import { validatePagination } from "../validators/pagination-validator.js";

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

// 팟트너의 지정 요청 반려
export async function rejectDesignatedRequestController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const designatedRequestId = parseBigId(req.params.designatedRequestId);

  if (designatedRequestId === null) {
    throw new AppError("INVALID_ID");
  }

  const reason = validateRejectDesignatedRequest(req.body);

  const createdRejectedRequest = await rejectDesignatedRequest(
    sitterId,
    designatedRequestId,
    reason,
  );

  const rejectedRequestResponse = {
    id: createdRejectedRequest.id,
    designatedRequestId: createdRejectedRequest.designatedRequestId,
    reason: createdRejectedRequest.reason,
    createdAt: createdRejectedRequest.createdAt,
  };

  res.status(201).json(serializeBigInt(rejectedRequestResponse));
}

// 팟트너의 반려 요청 이력 목록 조회
export async function getRejectedRequestsBySitterController(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }

  const sitterId = req.user.id;
  const { page, pageSize } = validatePagination(req.query.page, req.query.pageSize);

  const result = await getRejectedRequestsBySitter(sitterId, page, pageSize);

  const items = result.items.map((item) => ({
    rejectedRequest: {
      id: item.id,
      createdAt: item.createdAt,
    },
    designatedRequestId: item.designatedRequest.id,
    careRequest: {
      id: item.designatedRequest.careRequest.id,
      serviceType: item.designatedRequest.careRequest.serviceType,
      startDate: serializeDate(item.designatedRequest.careRequest.startDate),
      endDate: serializeDate(item.designatedRequest.careRequest.endDate),
      sido: item.designatedRequest.careRequest.sido,
      sigungu: item.designatedRequest.careRequest.sigungu,
      bname: item.designatedRequest.careRequest.bname,
      owner: {
        nickname: item.designatedRequest.careRequest.owner.nickname,
      },
    },
  }));

  res.status(200).json(
    serializeBigInt({
      items,
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
    }),
  );
}
