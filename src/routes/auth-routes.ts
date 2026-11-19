import { Router } from "express";

import {
  googleLogin,
  googleSignup,
  kakaoLogin,
  kakaoSignup,
  login,
  logout,
  refresh,
  signup,
} from "../controllers/auth-controller.js";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refresh);
router.post("/kakao", kakaoLogin);
router.post("/kakao/signup", kakaoSignup);
router.post("/google", googleLogin);
router.post("/google/signup", googleSignup);

export default router;
