import { Router } from "express";

import { getMe, updateMe, verifyPassword } from "../controllers/user-controller.js";
import { authenticate, requireReauth } from "../middlewares/auth-middleware.js";

const router = Router();

router.get("/me", authenticate, getMe);
router.post("/me/verify-password", authenticate, verifyPassword);
router.patch("/me", authenticate, requireReauth, updateMe);

export default router;
