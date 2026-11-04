import AppError from "../errors/app-error.js";
import type { ErrorCode } from "../errors/error-definitions.js";
import { Gender, Region, ServiceType } from "../generated/prisma/enums.js";
import type { SitterListQuery } from "../types/sitter.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 100;

function parseEnumList<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  errorCode: ErrorCode,
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
  return values;
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }
  const value = Number(raw);
  if (value < 1) throw new AppError("INVALID_PAGE_PARAMETER");
  return value;
}

export function validateSitterListQuery(query: Record<string, unknown>): SitterListQuery {
  let keyword: string | undefined;
  if (query.keyword !== undefined) {
    if (typeof query.keyword !== "string") throw new AppError("INVALID_REQUEST");
    keyword = query.keyword.trim() || undefined;
  }

  const pageSize = parsePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE);
  if (pageSize > MAX_PAGE_SIZE) throw new AppError("INVALID_PAGE_PARAMETER");

  return {
    keyword,
    regions: parseEnumList(query.regions, Object.values(Region), "INVALID_REGION"),
    services: parseEnumList(query.services, Object.values(ServiceType), "INVALID_SERVICE_TYPE"),
    genders: parseEnumList(query.gender, Object.values(Gender), "INVALID_GENDER"),
    page: parsePositiveInt(query.page, DEFAULT_PAGE),
    pageSize,
  };
}
