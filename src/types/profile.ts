import type { Region, ServiceType } from "../generated/prisma/enums.js";

export interface UpdateOwnerProfileInput {
  profileImageUrl?: string | null;
  preferredServiceTypes?: ServiceType[];
  livingRegion?: Region | null;
}
