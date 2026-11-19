import { Router } from "express";

import { linkGoogle, linkKakao } from "../controllers/auth-controller.js";
import { getMe, updateMe, verifyPassword } from "../controllers/user-controller.js";
import { authenticate, requireReauth } from "../middlewares/auth-middleware.js";

const router = Router();

router.get("/me", authenticate, getMe);
router.post("/me/verify-password", authenticate, verifyPassword);
router.post("/me/social-accounts/kakao", authenticate, linkKakao);
router.post("/me/social-accounts/google", authenticate, linkGoogle);
router.patch("/me", authenticate, requireReauth, updateMe);

export default router;
