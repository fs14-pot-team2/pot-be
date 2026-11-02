import { Router } from "express";
import {
  getOwnerProfileController,
  getSitterProfileController,
  updateOwnerProfileController,
} from "../controllers/profile-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const profileRouter = Router();

// 프로필 조회 - 팟오너
profileRouter.get(
  "/owners/me/profile",
  authenticate,
  authorize("OWNER"),
  getOwnerProfileController,
);

// 프로필 수정 - 팟오너
profileRouter.patch(
  "/owners/me/profile",
  authenticate,
  authorize("OWNER"),
  updateOwnerProfileController,
);

// 프로필 조회 - 팟트너
profileRouter.get(
  "/sitters/me/profile",
  authenticate,
  authorize("SITTER"),
  getSitterProfileController,
);
