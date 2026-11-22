import type { Request } from "express";
import type { AuthUser } from "./auth.js";

export type AuthenticatedRequest = Request & {
  user: AuthUser;
};
