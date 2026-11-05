import AppError from "../errors/app-error.js";
import {
  findDesignationRelation,
  findSitterDetailByUserId,
  findSitterListByUserIds,
  findSitterUserIdsByFilter,
} from "../repositories/sitter-repository.js";
import {
  DESIGNATED_REQUEST_STATUS,
  type SitterListQuery,
  type SitterViewer,
} from "../types/sitter.js";
import { getActiveCareRequest } from "./care-request-service.js";
import type { expireCareRequestIfPast } from "./care-request-expiration.js";
import { getSitterAggregates } from "./sitter-aggregate-service.js";

const MAX_DESIGNATED_REQUESTS = 3;

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

// 현재 로그인한 팟오너의 활성 돌봄 요청과 해당 팟트너의 관계로
// 지정 요청 가능 여부(status)와 지정 요청 ID 계산
async function getDesignatedRequestInfo(
  ownerId: bigint,
  sitterId: bigint,
  expireCareRequestIfPastFn?: typeof expireCareRequestIfPast,
) {
  // 만료 처리와 P2025 충돌 복구는 getActiveCareRequest가 담당
  const careRequest = await getActiveCareRequest(ownerId, expireCareRequestIfPastFn);
  if (!careRequest) {
    return {
      status: DESIGNATED_REQUEST_STATUS.NO_ACTIVE_REQUEST,
      designatedRequestId: null,
    };
  }

  const { designatedCount, hasDesignated, designatedRequestId, hasQuote } =
    await findDesignationRelation(careRequest.id, sitterId);

  let status: (typeof DESIGNATED_REQUEST_STATUS)[keyof typeof DESIGNATED_REQUEST_STATUS];
  if (hasQuote) {
    status = DESIGNATED_REQUEST_STATUS.ALREADY_SENT_QUOTE;
  } else if (hasDesignated) {
    status = DESIGNATED_REQUEST_STATUS.ALREADY_DESIGNATED;
  } else if (designatedCount >= MAX_DESIGNATED_REQUESTS) {
    status = DESIGNATED_REQUEST_STATUS.LIMIT_EXCEEDED;
  } else {
    status = DESIGNATED_REQUEST_STATUS.AVAILABLE;
  }

  return {
    status,
    designatedRequestId: designatedRequestId?.toString() ?? null,
  };
}

// 비로그인은 허용, 로그인했다면 OWNER만 조회 가능
export async function getSitterDetail(
  sitterId: bigint,
  viewer?: SitterViewer,
  expireCareRequestIfPastFn?: typeof expireCareRequestIfPast,
) {
  if (viewer && viewer.role !== "OWNER") {
    throw new AppError("SITTER_PROFILE_ACCESS_FORBIDDEN");
  }

  const profile = await findSitterDetailByUserId(sitterId);
  if (!profile) throw new AppError("SITTER_NOT_FOUND");

  const aggregate = (await getSitterAggregates([sitterId])).get(sitterId);
  const designation = viewer
    ? await getDesignatedRequestInfo(viewer.id, sitterId, expireCareRequestIfPastFn)
    : null;

  return {
    id: profile.userId.toString(),
    nickname: profile.user.nickname,
    profileImageUrl: profile.profileImageUrl ?? null,
    gender: profile.gender,
    shortIntroduction: profile.shortIntroduction,
    description: profile.description ?? null,
    serviceTypes: profile.sitterServices.map((service) => service.serviceType),
    serviceRegions: profile.sitterServiceRegions.map((item) => item.region),
    averageRating: aggregate?.averageRating ?? 0,
    reviewCount: aggregate?.reviewCount ?? 0,
    confirmedQuoteCount: aggregate?.confirmedQuoteCount ?? 0,
    designatedRequestId: designation?.designatedRequestId ?? null,
    designatedRequestStatus: designation?.status ?? null,
  };
}
