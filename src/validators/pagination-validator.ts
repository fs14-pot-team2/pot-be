import AppError from "../errors/app-error.js";
import { parseBigId } from "../utils/bigint.js";

function parsePositiveInteger(value: unknown, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  return parsed;
}

const MAX_PAGE_SIZE = 100;

// 페이지 기반 목록 조회의 공통 입력값 검증
export function validatePagination(page: unknown, pageSize: unknown, defaultPageSize = 8) {
  const validatedPageSize = parsePositiveInteger(pageSize, defaultPageSize);

  if (validatedPageSize > MAX_PAGE_SIZE) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  return {
    page: parsePositiveInteger(page, 1),
    pageSize: validatedPageSize,
  };
}

// 커서 기반 목록 조회의 공통 입력값 검증
export function validateCursorQuery(
  query: { cursor?: unknown; limit?: unknown },
  defaultLimit: number,
  maxLimit: number,
): { cursor: bigint | null; limit: number } {
  let cursor: bigint | null = null;

  if (query.cursor !== undefined) {
    cursor = parseBigId(query.cursor);

    if (cursor === null) {
      throw new AppError("INVALID_PAGE_PARAMETER");
    }
  }

  const limit = parsePositiveInteger(query.limit, defaultLimit);

  if (limit > maxLimit) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  return { cursor, limit };
}
