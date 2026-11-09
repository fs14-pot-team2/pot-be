import type { Gender, Region, ServiceType } from "../generated/prisma/enums.js";

export interface SitterListFilter {
  keyword?: string;
  regions?: Region[];
  serviceTypes?: ServiceType[];
  genders?: Gender[];
}

export const SITTER_SORTS = [
  "RATING_DESC",
  "REVIEW_COUNT_DESC",
  "CONFIRMED_QUOTE_COUNT_DESC",
] as const;
export type SitterSort = (typeof SITTER_SORTS)[number];

export interface SitterListQuery extends SitterListFilter {
  sort: SitterSort;
  page: number;
  pageSize: number;
}

export const DESIGNATED_REQUEST_STATUS = {
  AVAILABLE: "AVAILABLE",
  NO_ACTIVE_REQUEST: "NO_ACTIVE_REQUEST",
  ALREADY_DESIGNATED: "ALREADY_DESIGNATED",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  ALREADY_SENT_QUOTE: "ALREADY_SENT_QUOTE",
} as const;

export interface SitterViewer {
  id: bigint;
  role: string;
}
