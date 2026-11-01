import { Router } from "express";
import { getOwnerProfileController } from "../controllers/profile-controller.js";
import { authenticate, authorize } from "../middlewares/auth.js";

export const profileRouter = Router();

// 프로필 조회 - 팟오너
profileRouter.get(
  "/owners/me/profile",
  authenticate,
  authorize("OWNER"),
  getOwnerProfileController,
);
