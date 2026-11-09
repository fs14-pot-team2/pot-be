import { Router } from "express";
import {
  deleteReviewController,
  getMyReviewsController,
  getWritableReviewsController,
  updateReviewController,
} from "../controllers/review-controller.js";
import { authenticate, authorize } from "../middlewares/auth-middleware.js";

export const reviewRouter = Router();

// 팟오너
// 작성 가능한 리뷰 목록 조회
reviewRouter.get(
  "/owners/me/reviews/writable",
  authenticate,
  authorize("OWNER"),
  getWritableReviewsController,
);

// 내가 작성한 리뷰 목록 조회
reviewRouter.get("/owners/me/reviews", authenticate, authorize("OWNER"), getMyReviewsController);
// 내가 작성한 리뷰 수정
reviewRouter.patch("/reviews/:reviewId", authenticate, authorize("OWNER"), updateReviewController);

// 내가 작성한 리뷰 삭제
reviewRouter.delete("/reviews/:reviewId", authenticate, authorize("OWNER"), deleteReviewController);
