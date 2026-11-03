import type { Gender, Region, ServiceType } from "../generated/prisma/enums.js";

export interface UpdateOwnerProfileInput {
  profileImageUrl?: string | null;
  preferredServiceTypes?: ServiceType[];
  livingRegion?: Region | null;
}

export interface CreateSitterProfileInput {
  profileImageUrl: string | null;
  description: string | null;
  gender: Gender;
  shortIntroduction: string;
  serviceTypes: ServiceType[];
  serviceRegions: Region[];
}

export interface UpdateSitterProfileInput {
  profileImageUrl?: string | null;
  description?: string | null;
  gender?: Gender;
  shortIntroduction?: string;
  serviceTypes?: ServiceType[];
  serviceRegions?: Region[];
}
