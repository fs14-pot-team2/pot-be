import AppError from "../errors/app-error.js";
import { CareRequestStatus } from "../generated/prisma/enums.js";
import {
  countReviewsByOwnerId,
  findReviewsByOwnerId,
  deleteReviewById,
  countWritableCareRequests,
  existsSitterProfileByUserId,
  findCareRequestForReview,
  findReviewOwnerById,
  findReviewByCareRequestId,
  findReviewsBySitterId,
  findWritableCareRequests,
  groupRatingDistribution,
  insertReview,
  updateReviewById,
} from "../repositories/review-repository.js";
import { getTodayInKst, isBeforeTodayInKst } from "../utils/kst-date.js";
import { getUniqueConstraintName, isRecordNotFoundError } from "../utils/prisma-error.js";
import { serializeDate } from "../utils/serialize-date.js";
import type { CreateReviewInput, UpdateReviewInput } from "../validators/review-validator.js";
import { getSitterAggregates } from "./sitter-aggregate-service.js";

const REVIEW_CARE_REQUEST_UNIQUE_INDEX = "Review_careRequestId_key";

export async function getSitterReviews(sitterId: bigint, page: number, pageSize: number) {
  const skip = (page - 1) * pageSize;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  if (!(await existsSitterProfileByUserId(sitterId))) {
    throw new AppError("SITTER_NOT_FOUND");
  }

  const [reviews, distributionRows, aggregates] = await Promise.all([
    findReviewsBySitterId(sitterId, skip, pageSize),
    groupRatingDistribution(sitterId),
    getSitterAggregates([sitterId]),
  ]);

  const ratingDistribution: Record<string, number> = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
  for (const row of distributionRows) {
    ratingDistribution[String(row.rating)] = row._count._all;
  }

  const aggregate = aggregates.get(sitterId)!;
  const totalCount = aggregate.reviewCount;

  return {
    summary: {
      averageRating: aggregate.averageRating,
      reviewCount: aggregate.reviewCount,
      ratingDistribution,
    },
    items: reviews.map((review) => ({
      review: {
        id: review.id.toString(),
        rating: review.rating,
        content: review.content,
        createdAt: review.createdAt.toISOString(),
      },
      owner: {
        id: review.owner.id.toString(),
        nickname: review.owner.nickname,
      },
    })),
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

export async function createReview(
  userId: bigint,
  careRequestId: bigint,
  input: CreateReviewInput,
) {
  const careRequest = await findCareRequestForReview(careRequestId);

  if (!careRequest) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  if (careRequest.ownerId !== userId) {
    throw new AppError("FORBIDDEN");
  }

  // MATCHED + 확정 견적 존재 + endDate 다음 날 00:00(KST) 이후만 작성 가능
  if (
    careRequest.status !== CareRequestStatus.MATCHED ||
    !careRequest.confirmedQuote ||
    !isBeforeTodayInKst(careRequest.endDate)
  ) {
    throw new AppError("REVIEW_NOT_WRITABLE");
  }

  if (await findReviewByCareRequestId(careRequestId)) {
    throw new AppError("REVIEW_ALREADY_EXISTS");
  }

  try {
    const review = await insertReview({
      careRequestId,
      ownerId: userId,
      sitterId: careRequest.confirmedQuote.sitterId,
      rating: input.rating,
      content: input.content,
    });

    return {
      id: review.id.toString(),
      careRequestId: review.careRequestId.toString(),
      ownerId: review.ownerId.toString(),
      sitterId: review.sitterId.toString(),
      rating: review.rating,
      content: review.content,
      createdAt: review.createdAt.toISOString(),
    };
  } catch (error) {
    // 사전 검증 이후 동시 요청으로 careRequestId UNIQUE 충돌 시
    if (getUniqueConstraintName(error) === REVIEW_CARE_REQUEST_UNIQUE_INDEX) {
      throw new AppError("REVIEW_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function getWritableReviews(ownerId: bigint, page: number, pageSize: number) {
  const skip = (page - 1) * pageSize;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const today = new Date(`${getTodayInKst()}T00:00:00.000Z`);

  const [careRequests, totalCount] = await Promise.all([
    findWritableCareRequests(ownerId, today, skip, pageSize),
    countWritableCareRequests(ownerId, today),
  ]);

  return {
    items: careRequests.map((careRequest) => {
      // where 조건에서 confirmedQuoteId not null을 보장하므로 항상 존재
      const quote = careRequest.confirmedQuote!;
      return {
        careRequest: {
          id: careRequest.id.toString(),
          serviceType: careRequest.serviceType,
          endDate: serializeDate(careRequest.endDate),
        },
        confirmedQuote: {
          id: quote.id.toString(),
          type: quote.type,
          price: quote.price,
        },
        sitter: {
          id: quote.sitter.id.toString(),
          nickname: quote.sitter.nickname,
          profileImageUrl: quote.sitter.sitterProfile?.profileImageUrl ?? null,
        },
      };
    }),
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

export async function getMyReviews(ownerId: bigint, page: number, pageSize: number) {
  const skip = (page - 1) * pageSize;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const [reviews, totalCount] = await Promise.all([
    findReviewsByOwnerId(ownerId, skip, pageSize),
    countReviewsByOwnerId(ownerId),
  ]);

  return {
    items: reviews.map((review) => {
      // 리뷰는 확정 견적이 있는 요청에만 작성되므로 항상 존재
      const quote = review.careRequest.confirmedQuote!;
      return {
        review: {
          id: review.id.toString(),
          rating: review.rating,
          content: review.content,
          createdAt: review.createdAt.toISOString(),
        },
        careRequest: {
          id: review.careRequest.id.toString(),
          serviceType: review.careRequest.serviceType,
          endDate: serializeDate(review.careRequest.endDate),
        },
        confirmedQuote: {
          type: quote.type,
          price: quote.price,
        },
        sitter: {
          id: quote.sitter.id.toString(),
          nickname: quote.sitter.nickname,
          profileImageUrl: quote.sitter.sitterProfile?.profileImageUrl ?? null,
        },
      };
    }),
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

// 리뷰 존재 + 작성자 본인 확인 (수정·삭제 공통)
async function assertReviewOwner(userId: bigint, reviewId: bigint) {
  const review = await findReviewOwnerById(reviewId);

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND");
  }

  if (review.ownerId !== userId) {
    throw new AppError("REVIEW_ACCESS_FORBIDDEN");
  }
}

// 수정·삭제 중 대상 리뷰가 사라진 경우 (P2025 공통 기준: 재조회 후 소실이면 비즈니스 에러)
async function handleReviewWriteError(error: unknown, reviewId: bigint): Promise<never> {
  if (isRecordNotFoundError(error) && !(await findReviewOwnerById(reviewId))) {
    throw new AppError("REVIEW_NOT_FOUND");
  }
  // 원인을 식별할 수 없으면 원본 전파 (INTERNAL_SERVER_ERROR)
  throw error;
}

export async function updateReview(userId: bigint, reviewId: bigint, input: UpdateReviewInput) {
  await assertReviewOwner(userId, reviewId);

  try {
    const review = await updateReviewById(reviewId, input);

    return {
      id: review.id.toString(),
      careRequestId: review.careRequestId.toString(),
      ownerId: review.ownerId.toString(),
      sitterId: review.sitterId.toString(),
      rating: review.rating,
      content: review.content,
      updatedAt: review.updatedAt.toISOString(),
    };
  } catch (error) {
    return handleReviewWriteError(error, reviewId);
  }
}

export async function deleteReview(userId: bigint, reviewId: bigint) {
  await assertReviewOwner(userId, reviewId);

  try {
    await deleteReviewById(reviewId);
  } catch (error) {
    return handleReviewWriteError(error, reviewId);
  }

  return { message: "리뷰가 삭제되었습니다." };
}
