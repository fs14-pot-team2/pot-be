import { Router } from "express";
import { connectEventsController } from "../controllers/sse-controller.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const sseRouter = Router();

// 알림·쪽지 실시간 수신 연결 (팟오너·팟트너 공통)
sseRouter.get("/", withAuthentication(connectEventsController));
