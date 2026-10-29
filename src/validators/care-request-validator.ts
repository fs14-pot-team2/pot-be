import { ServiceType, type Region } from "../generated/prisma/enums.js";
import AppError from "../errors/app-error.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { toRegion } from "../utils/region.js";

export interface CreateCareRequestInput {
  serviceType: ServiceType;
  startDate: string;
  endDate: string;
  zonecode: string;
  address: string;
  detailAddress: string | null;
  sido: string;
  sigungu: string;
  bname: string | null;
  region: Region;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZONECODE_PATTERN = /^\d{5}$/;

function isRequestBodyObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("INVALID_REQUEST");
  }

  return value;
}

function validateZonecode(value: unknown): string {
  if (typeof value !== "string" || !ZONECODE_PATTERN.test(value)) {
    throw new AppError("INVALID_REQUEST");
  }

  return value;
}

/**
 * 선택 문자열 입력값 정규화
 * - undefined, null: 미입력으로 판단하여 null 반환
 * - 빈 문자열, 공백만 있는 문자열: null 반환
 * - 유효한 문자열: 원본 값 유지
 * - 문자열이 아닌 값(숫자, 배열, 객체 등): INVALID_REQUEST
 *
 * 생성 요청 기준으로 수정 시 필드 생략은 기존 값 유지로 구분함.
 */
function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new AppError("INVALID_REQUEST");
  }

  return value.trim().length === 0 ? null : value;
}

function isServiceType(value: unknown): value is ServiceType {
  return Object.values(ServiceType).some((type) => type === value);
}

function validateServiceType(value: unknown): ServiceType {
  if (!isServiceType(value)) {
    throw new AppError("INVALID_SERVICE_TYPE");
  }

  return value;
}

// 날짜 존재 여부만 검사
function validateDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new AppError("INVALID_CARE_DATE");
  }

  const [year, month, day] = value.split("-").map(Number);

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    year < 1 ||
    month < 1 ||
    month > 12
  ) {
    throw new AppError("INVALID_CARE_DATE");
  }

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const maxDay = daysInMonth[month - 1];

  if (maxDay === undefined || day < 1 || day > maxDay) {
    throw new AppError("INVALID_CARE_DATE");
  }

  return value;
}

function validateCareDates(
  startDateValue: unknown,
  endDateValue: unknown,
): { startDate: string; endDate: string } {
  const startDate = validateDate(startDateValue);
  const endDate = validateDate(endDateValue);

  if (startDate <= getTodayInKst() || startDate > endDate) {
    throw new AppError("INVALID_CARE_DATE");
  }

  return { startDate, endDate };
}

export function validateCreateCareRequest(body: unknown): CreateCareRequestInput {
  if (!isRequestBodyObject(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const zonecode = validateZonecode(body.zonecode);
  const address = requireString(body.address);
  const detailAddress = optionalString(body.detailAddress);
  const sido = requireString(body.sido);
  const sigungu = requireString(body.sigungu);
  const bname = optionalString(body.bname);

  const serviceType = validateServiceType(body.serviceType);
  const { startDate, endDate } = validateCareDates(body.startDate, body.endDate);
  const region = toRegion(sido);

  return {
    serviceType,
    startDate,
    endDate,
    zonecode,
    address,
    detailAddress,
    sido,
    sigungu,
    bname,
    region,
  };
}
