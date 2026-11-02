import AppError from "../errors/app-error.js";
import { Gender, Region, ServiceType } from "../generated/prisma/enums.js";
import type { UpdateOwnerProfileInput, UpdateSitterProfileInput } from "../types/profile.js";

const MAX_SERVICE_TYPES = 2;
const MAX_PROFILE_IMAGE_URL_LENGTH = 2048;

const SHORT_INTRODUCTION_MAX = 18;
const DESCRIPTION_MAX = 1000;
const MAX_SERVICE_REGIONS = 17;

function isServiceType(value: unknown): value is ServiceType {
  return typeof value === "string" && (Object.values(ServiceType) as string[]).includes(value);
}

function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (Object.values(Region) as string[]).includes(value);
}

function countWithoutSpace(value: string) {
  return value.replace(/\s/g, "").length;
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

// 팟트너 프로필 검증
export function validateGender(value: unknown): Gender {
  if (typeof value !== "string" || !(Object.values(Gender) as string[]).includes(value)) {
    throw new AppError("INVALID_GENDER");
  }
  return value as Gender;
}

export function validateShortIntroduction(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("INVALID_PROFILE_INTRODUCTION");
  }
  const length = countWithoutSpace(value);
  if (length < 1 || length > SHORT_INTRODUCTION_MAX) {
    throw new AppError("INVALID_PROFILE_INTRODUCTION");
  }
  return value;
}

export function validateDescription(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || countWithoutSpace(value) > DESCRIPTION_MAX) {
    throw new AppError("INVALID_PROFILE_DESCRIPTION");
  }
  return value;
}

// 팟트너 제공 서비스: 1~2개, 중복 불가
export function validateSitterServiceTypes(value: unknown): ServiceType[] {
  if (!Array.isArray(value) || value.length < 1 || !value.every(isServiceType)) {
    throw new AppError("INVALID_SERVICE_TYPE");
  }
  if (value.length > MAX_SERVICE_TYPES) {
    throw new AppError("TOO_MANY_SERVICE_TYPES");
  }
  if (new Set(value).size !== value.length) {
    throw new AppError("SERVICE_TYPE_ALREADY_EXISTS");
  }
  return value;
}

// 팟트너 서비스 가능 지역: 1~17개, 중복 불가
export function validateServiceRegions(value: unknown): Region[] {
  if (!Array.isArray(value) || value.length < 1 || !value.every(isRegion)) {
    throw new AppError("INVALID_REGION");
  }
  if (value.length > MAX_SERVICE_REGIONS) {
    throw new AppError("TOO_MANY_SERVICE_REGIONS");
  }
  if (new Set(value).size !== value.length) {
    throw new AppError("SERVICE_REGION_ALREADY_EXISTS");
  }
  return value;
}

export function validateUpdateSitterProfile(body: unknown): UpdateSitterProfileInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const input: UpdateSitterProfileInput = {};

  if ("profileImageUrl" in body) {
    input.profileImageUrl = validateProfileImageUrl(body.profileImageUrl);
  }
  if ("gender" in body) {
    input.gender = validateGender(body.gender);
  }
  if ("shortIntroduction" in body) {
    input.shortIntroduction = validateShortIntroduction(body.shortIntroduction);
  }
  if ("description" in body) {
    input.description = validateDescription(body.description);
  }
  if ("serviceTypes" in body) {
    input.serviceTypes = validateSitterServiceTypes(body.serviceTypes);
  }
  if ("serviceRegions" in body) {
    input.serviceRegions = validateServiceRegions(body.serviceRegions);
  }

  return input;
}
