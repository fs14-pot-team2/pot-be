import { Router } from "express";
import { getSitterListController } from "../controllers/sitter-controller.js";
import { optionalAuthenticate } from "../middlewares/auth-middleware.js";

export const sitterRouter = Router();

// 팟트너 찾기 목록 조회 - 비로그인 가능 (선택적 인증)
sitterRouter.get("/sitters", optionalAuthenticate, getSitterListController);
