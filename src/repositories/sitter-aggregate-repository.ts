import { prisma } from "../config/prisma.js";

export function groupReviewStats(sitterIds: bigint[]) {
  return prisma.review.groupBy({
    by: ["sitterId"],
    where: { sitterId: { in: sitterIds }, deletedAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });
}

export function groupConfirmedQuoteCounts(sitterIds: bigint[]) {
  return prisma.quote.groupBy({
    by: ["sitterId"],
    where: {
      sitterId: { in: sitterIds },
      confirmedInRequest: { isNot: null },
    },
    _count: { _all: true },
  });
}
