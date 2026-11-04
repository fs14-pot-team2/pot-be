import AppError from "../errors/app-error.js";
import { parseBigId } from "../utils/bigint.js";

export function validateCreateDesignatedRequest(body: unknown): bigint {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const sitterId = parseBigId((body as Record<string, unknown>).sitterId);

  if (sitterId === null) {
    throw new AppError("INVALID_REQUEST");
  }

  return sitterId;
}

// 지정 요청 반려 사유 검증
export function validateRejectDesignatedRequest(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const rejectionReason = (body as Record<string, unknown>).reason;

  if (rejectionReason === undefined) {
    throw new AppError("INVALID_REQUEST");
  }

  if (typeof rejectionReason !== "string") {
    throw new AppError("INVALID_REJECTION_REASON");
  }

  const rejectionReasonLength = rejectionReason.replace(/\s/g, "").length;

  if (rejectionReasonLength < 10 || rejectionReasonLength > 100) {
    throw new AppError("INVALID_REJECTION_REASON");
  }

  return rejectionReason;
}
