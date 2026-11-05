import type { Gender, Region, ServiceType } from "../generated/prisma/enums.js";

export interface SitterListFilter {
  keyword?: string;
  regions?: Region[];
  services?: ServiceType[];
  genders?: Gender[];
}

export interface SitterListQuery extends SitterListFilter {
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
