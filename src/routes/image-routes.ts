import { Router } from "express";

import { issueProfileImageUrlController } from "../controllers/image-controller.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const imageRouter = Router();

imageRouter.post("/presigned-url", withAuthentication(issueProfileImageUrlController));
