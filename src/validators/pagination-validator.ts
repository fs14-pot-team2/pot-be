import AppError from "../errors/app-error.js";

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

// 페이지 기반 목록 조회의 공통 입력값 검증 (pageSize 최대값은 별도 정책이 없어 제한하지 않음)
export function validatePagination(page: unknown, pageSize: unknown, defaultPageSize = 8) {
  return {
    page: parsePositiveInteger(page, 1),
    pageSize: parsePositiveInteger(pageSize, defaultPageSize),
  };
}
