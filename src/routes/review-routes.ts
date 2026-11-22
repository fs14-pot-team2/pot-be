import { Router } from "express";
import {
  deleteReviewController,
  getMyReviewsController,
  getWritableReviewsController,
  updateReviewController,
} from "../controllers/review-controller.js";
import { authorize } from "../middlewares/auth-middleware.js";
import { withAuthentication } from "../middlewares/authenticated-handler.js";

export const reviewRouter = Router();

// 팟오너
// 작성 가능한 리뷰 목록 조회
reviewRouter.get(
  "/owners/me/reviews/writable",
  withAuthentication(getWritableReviewsController, authorize("OWNER")),
);

// 내가 작성한 리뷰 목록 조회
reviewRouter.get(
  "/owners/me/reviews",
  withAuthentication(getMyReviewsController, authorize("OWNER")),
);
// 내가 작성한 리뷰 수정
reviewRouter.patch(
  "/reviews/:reviewId",
  withAuthentication(updateReviewController, authorize("OWNER")),
);

// 내가 작성한 리뷰 삭제
reviewRouter.delete(
  "/reviews/:reviewId",
  withAuthentication(deleteReviewController, authorize("OWNER")),
);
