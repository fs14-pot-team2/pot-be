import { Router } from "express";
import {
  createSitterProfileController,
  getOwnerProfileController,
  getSitterProfileController,
  updateOwnerProfileController,
  updateSitterProfileController,
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

// 프로필 등록 - 팟트너
profileRouter.post(
  "/sitters/me/profile",
  authenticate,
  authorize("SITTER"),
  createSitterProfileController,
);

// 프로필 조회 - 팟트너
profileRouter.get(
  "/sitters/me/profile",
  authenticate,
  authorize("SITTER"),
  getSitterProfileController,
);

// 프로필 수정 - 팟트너
profileRouter.patch(
  "/sitters/me/profile",
  authenticate,
  authorize("SITTER"),
  updateSitterProfileController,
);
