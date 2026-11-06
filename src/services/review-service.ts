import AppError from "../errors/app-error.js";
import {
  existsSitterProfileByUserId,
  findReviewsBySitterId,
  groupRatingDistribution,
} from "../repositories/review-repository.js";
import { getSitterAggregates } from "./sitter-aggregate-service.js";

export async function getSitterReviews(sitterId: bigint, page: number, pageSize: number) {
  if (!(await existsSitterProfileByUserId(sitterId))) {
    throw new AppError("SITTER_NOT_FOUND");
  }

  const [reviews, distributionRows, aggregates] = await Promise.all([
    findReviewsBySitterId(sitterId, (page - 1) * pageSize, pageSize),
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
