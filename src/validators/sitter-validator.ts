import AppError from "../errors/app-error.js";
import type { ErrorCode } from "../errors/error-definitions.js";
import { Gender, Region, ServiceType } from "../generated/prisma/enums.js";
import type { SitterListQuery } from "../types/sitter.js";

import { validatePagination } from "./pagination-validator.js";

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

export function validateSitterListQuery(query: Record<string, unknown>): SitterListQuery {
  let keyword: string | undefined;
  if (query.keyword !== undefined) {
    if (typeof query.keyword !== "string") throw new AppError("INVALID_REQUEST");
    keyword = query.keyword.trim() || undefined;
  }

  const { page, pageSize } = validatePagination(query.page, query.pageSize);

  return {
    keyword,
    regions: parseEnumList(query.regions, Object.values(Region), "INVALID_REGION"),
    services: parseEnumList(query.services, Object.values(ServiceType), "INVALID_SERVICE_TYPE"),
    genders: parseEnumList(query.gender, Object.values(Gender), "INVALID_GENDER"),
    page,
    pageSize,
  };
}
