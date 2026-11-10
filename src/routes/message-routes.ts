import { Router } from "express";
import { getConversationsController } from "../controllers/message-controller.js";
import { authenticate } from "../middlewares/auth-middleware.js";

export const messageRouter = Router();

// 대화방 목록 조회
messageRouter.get("/conversations", authenticate, getConversationsController);
