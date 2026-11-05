import { Router } from "express";

import { issueProfileImageUrlController } from "../controllers/image-controller.js";
import { authenticate } from "../middlewares/auth-middleware.js";

export const imageRouter = Router();

imageRouter.post("/profile/presigned-url", authenticate, issueProfileImageUrlController);
