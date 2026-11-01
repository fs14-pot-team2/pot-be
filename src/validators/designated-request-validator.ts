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
