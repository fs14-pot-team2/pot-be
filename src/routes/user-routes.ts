import { Router } from "express";

import { getMe } from "../controllers/user-controller.js";
import { authenticate } from "../middlewares/auth-middleware.js";

const router = Router();

router.get("/me", authenticate, getMe);

export default router;
