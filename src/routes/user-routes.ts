import { Router } from "express";

import { linkGoogle, linkKakao } from "../controllers/auth-controller.js";
import { getMe, updateMe, verifyPassword } from "../controllers/user-controller.js";
import { requireReauth } from "../middlewares/auth-middleware.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

const router = Router();

router.get("/me", withAuthentication(getMe));
router.post("/me/verify-password", withAuthentication(verifyPassword));
router.post("/me/social-accounts/kakao", withAuthentication(linkKakao));
router.post("/me/social-accounts/google", withAuthentication(linkGoogle));
router.patch("/me", withAuthentication(updateMe, requireReauth));

export default router;
