import AppError from "../errors/app-error.js";
import { Region, ServiceType } from "../generated/prisma/enums.js";
import type { UpdateOwnerProfileInput } from "../types/profile.js";

const MAX_SERVICE_TYPES = 2;
const MAX_PROFILE_IMAGE_URL_LENGTH = 2048;

function isServiceType(value: unknown): value is ServiceType {
  return typeof value === "string" && (Object.values(ServiceType) as string[]).includes(value);
}

function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (Object.values(Region) as string[]).includes(value);
}

export function validateProfileImageUrl(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > MAX_PROFILE_IMAGE_URL_LENGTH) {
    throw new AppError("INVALID_PROFILE_IMAGE");
  }
  try {
    const { protocol } = new URL(value);
    if (protocol !== "http:" && protocol !== "https:") {
      throw new AppError("INVALID_PROFILE_IMAGE");
    }
  } catch {
    throw new AppError("INVALID_PROFILE_IMAGE");
  }
  return value;
}

export function validateServiceTypes(value: unknown): ServiceType[] {
  if (!Array.isArray(value) || !value.every(isServiceType)) {
    throw new AppError("INVALID_SERVICE_TYPE");
  }
  if (value.length > MAX_SERVICE_TYPES) {
    throw new AppError("TOO_MANY_SERVICE_TYPES");
  }
  // 같은 유형은 중복 선택할 수 없음
  if (new Set(value).size !== value.length) {
    throw new AppError("INVALID_SERVICE_TYPE");
  }
  return value;
}

export function validateRegion(value: unknown): Region | null {
  if (value === null) {
    return null;
  }
  if (!isRegion(value)) {
    throw new AppError("INVALID_REGION");
  }
  return value;
}

export function validateUpdateOwnerProfile(body: unknown): UpdateOwnerProfileInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const input: UpdateOwnerProfileInput = {};

  if ("profileImageUrl" in body) {
    input.profileImageUrl = validateProfileImageUrl(body.profileImageUrl);
  }
  if ("preferredServiceTypes" in body) {
    input.preferredServiceTypes = validateServiceTypes(body.preferredServiceTypes);
  }
  if ("livingRegion" in body) {
    input.livingRegion = validateRegion(body.livingRegion);
  }

  return input;
}
