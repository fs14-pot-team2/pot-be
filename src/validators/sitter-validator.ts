import AppError from "../errors/app-error.js";
import type { ErrorCode } from "../errors/error-definitions.js";
import { Gender, Region, ServiceType } from "../generated/prisma/enums.js";
import { SITTER_SORTS, type SitterListQuery, type SitterSort } from "../types/sitter.js";
import { parseBigId } from "../utils/bigint.js";

import { validatePagination } from "./pagination-validator.js";

// 쿼리 파라미터별 최대 선택 개수 (API 명세 기준)
// regions: 17개 전체 선택은 '전체'이므로 파라미터를 생략해 최대 16개
const MAX_SERVICE_TYPES = 1;
const MAX_REGIONS = 16;
const MAX_GENDERS = 1;

function parseEnumList<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  errorCode: ErrorCode,
  maxCount: number,
): T[] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new AppError(errorCode);

  const values = [
    ...new Set(
      raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0) return undefined;

  if (!values.every((v): v is T => (allowed as readonly string[]).includes(v))) {
    throw new AppError(errorCode);
  }

  if (values.length > maxCount) {
    throw new AppError(errorCode);
  }

  return values;
}

export function validateSitterListQuery(query: Record<string, unknown>): SitterListQuery {
  let keyword: string | undefined;
  if (query.keyword !== undefined) {
    if (typeof query.keyword !== "string") throw new AppError("INVALID_REQUEST");
    keyword = query.keyword.trim() || undefined;
  }

  const { page, pageSize } = validatePagination(query.page, query.pageSize);

  return {
    keyword,
    regions: parseEnumList(query.regions, Object.values(Region), "INVALID_REGION", MAX_REGIONS),
    serviceTypes: parseEnumList(
      query.serviceTypes,
      Object.values(ServiceType),
      "INVALID_SERVICE_TYPE",
      MAX_SERVICE_TYPES,
    ),
    genders: parseEnumList(query.gender, Object.values(Gender), "INVALID_GENDER", MAX_GENDERS),
    sort: parseSort(query.sort),
    page,
    pageSize,
  };
}

function parseSort(raw: unknown): SitterSort {
  if (raw === undefined) return "RATING_DESC";
  if (typeof raw !== "string" || !(SITTER_SORTS as readonly string[]).includes(raw)) {
    throw new AppError("INVALID_REQUEST");
  }
  return raw as SitterSort;
}

export function validateSitterIdParam(value: unknown): bigint {
  const id = parseBigId(value);
  if (id === null) throw new AppError("INVALID_ID");
  return id;
}
