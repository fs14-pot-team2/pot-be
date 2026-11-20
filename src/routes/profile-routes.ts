import { Router } from "express";
import {
  createSitterProfileController,
  getOwnerProfileController,
  getSitterProfileController,
  updateOwnerProfileController,
  updateSitterProfileController,
  getSitterMyPageController,
} from "../controllers/profile-controller.js";
import { authorize } from "../middlewares/auth-middleware.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const profileRouter = Router();

// 프로필 조회 - 팟오너
profileRouter.get(
  "/owners/me/profile",
  withAuthentication(getOwnerProfileController, authorize("OWNER")),
);

// 프로필 수정 - 팟오너
profileRouter.patch(
  "/owners/me/profile",
  withAuthentication(updateOwnerProfileController, authorize("OWNER")),
);

// 프로필 등록 - 팟트너
profileRouter.post(
  "/sitters/me/profile",
  withAuthentication(createSitterProfileController, authorize("SITTER")),
);

// 프로필 조회 - 팟트너
profileRouter.get(
  "/sitters/me/profile",
  withAuthentication(getSitterProfileController, authorize("SITTER")),
);

// 프로필 수정 - 팟트너
profileRouter.patch(
  "/sitters/me/profile",
  withAuthentication(updateSitterProfileController, authorize("SITTER")),
);

// 마이페이지 조회 - 팟트너
profileRouter.get(
  "/sitters/me",
  withAuthentication(getSitterMyPageController, authorize("SITTER")),
);
