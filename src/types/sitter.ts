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
