import { Router } from "express";

import { getMe, updateMe, verifyPassword } from "../controllers/user-controller.js";
import { authenticate } from "../middlewares/auth-middleware.js";

const router = Router();

router.get("/me", authenticate, getMe);
router.post("/me/verify-password", authenticate, verifyPassword);
router.patch("/me", authenticate, updateMe);

export default router;
