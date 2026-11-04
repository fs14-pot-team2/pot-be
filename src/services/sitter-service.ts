import {
  findSitterListByUserIds,
  findSitterUserIdsByFilter,
} from "../repositories/sitter-repository.js";
import type { SitterListQuery } from "../types/sitter.js";
import { getSitterAggregates } from "./sitter-aggregate-service.js";

export async function getSitterList(query: SitterListQuery) {
  const { page, pageSize, ...filter } = query;

  const userIds = await findSitterUserIdsByFilter(filter);
  const aggregates = await getSitterAggregates(userIds);

  // 평점 ↓ → 리뷰 수 ↓ → userId ↑ (동점이어도 순서 고정)
  const sortedIds = [...userIds].sort((a, b) => {
    const x = aggregates.get(a)!;
    const y = aggregates.get(b)!;
    return (
      y.averageRating - x.averageRating ||
      y.reviewCount - x.reviewCount ||
      (a < b ? -1 : a > b ? 1 : 0)
    );
  });

  const totalCount = sortedIds.length;
  const pageIds = sortedIds.slice((page - 1) * pageSize, page * pageSize);

  const profiles = await findSitterListByUserIds(pageIds);
  const profileById = new Map(profiles.map((profile) => [profile.userId, profile]));

  const items = pageIds.flatMap((id) => {
    const profile = profileById.get(id);
    if (!profile) return [];
    const aggregate = aggregates.get(id)!;
    return [
      {
        id: profile.userId.toString(),
        nickname: profile.user.nickname,
        profileImageUrl: profile.profileImageUrl ?? null,
        gender: profile.gender,
        shortIntroduction: profile.shortIntroduction,
        description: null,
        serviceTypes: profile.sitterServices.map((service) => service.serviceType),
        serviceRegions: profile.sitterServiceRegions.map((item) => item.region),
        averageRating: aggregate.averageRating,
        reviewCount: aggregate.reviewCount,
        confirmedQuoteCount: aggregate.confirmedQuoteCount,
      },
    ];
  });

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}
