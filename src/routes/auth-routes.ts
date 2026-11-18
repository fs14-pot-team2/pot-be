import { Router } from "express";

import {
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

export default router;
