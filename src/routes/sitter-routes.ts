import { Router } from "express";
import {
  getSitterDetailController,
  getSitterListController,
} from "../controllers/sitter-controller.js";
import { optionalAuthenticate } from "../middlewares/auth-middleware.js";

export const sitterRouter = Router();

// 팟트너 찾기 목록 조회 - 비로그인 가능 (선택적 인증)
sitterRouter.get("/sitters", optionalAuthenticate, getSitterListController);

// 팟트너 상세 조회 - 비로그인 가능, 로그인 시 OWNER만 (선택적 인증)
sitterRouter.get("/sitters/:sitterId", optionalAuthenticate, getSitterDetailController);
