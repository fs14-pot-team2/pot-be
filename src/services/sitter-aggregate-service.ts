import {
  groupConfirmedQuoteCounts,
  groupReviewStats,
} from "../repositories/sitter-aggregate-repository.js";

export interface SitterAggregate {
  averageRating: number;
  reviewCount: number;
  confirmedQuoteCount: number;
}

export async function getSitterAggregates(sitterIds: bigint[]) {
  const result = new Map<bigint, SitterAggregate>(
    sitterIds.map((id) => [id, { averageRating: 0, reviewCount: 0, confirmedQuoteCount: 0 }]),
  );
  if (sitterIds.length === 0) {
    return result;
  }

  const [reviews, confirmedQuotes] = await Promise.all([
    groupReviewStats(sitterIds),
    groupConfirmedQuoteCounts(sitterIds),
  ]);

  for (const row of reviews) {
    const aggregate = result.get(row.sitterId);
    if (aggregate) {
      aggregate.reviewCount = row._count._all;
      aggregate.averageRating = Math.round((row._avg.rating ?? 0) * 10) / 10;
    }
  }
  for (const row of confirmedQuotes) {
    const aggregate = result.get(row.sitterId);
    if (aggregate) {
      aggregate.confirmedQuoteCount = row._count._all;
    }
  }

  return result;
}
