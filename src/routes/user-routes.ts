import { Router } from "express";

import { getMe } from "../controllers/user-controller.js";
import { authenticate } from "../middlewares/auth.js";

const router = Router();

router.get("/me", authenticate, getMe);

export default router;
