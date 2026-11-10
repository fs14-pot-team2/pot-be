import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { CareRequestStatus, type Region } from "../generated/prisma/enums.js";
import AppError from "../errors/app-error.js";
import type { TransactionRunner } from "../types/db.js";
import {
  cancelCareRequest,
  countReceivedCareRequests,
  expireReceivedCareRequests,
  findCareRequest,
  findCareRequestHistory,
  findCareRequestQuotesHistoryByOwner,
  findOpenCareRequest,
  findOpenCareRequestQuotes,
  findQuoteByCareRequestId,
  findReceivedCareRequests,
  findReceivedDesignatedRequestRegions,
  findSitterProfileWithRegions,
  insertCareRequest,
  lockCareRequestForUpdate,
  updateOpenCareRequest,
} from "../repositories/care-request-repository.js";
import { findSitterProfilesForQuotes } from "../repositories/sitter-repository.js";
import { getSitterAggregates } from "./sitter-aggregate-service.js";
import { expireCareRequestIfPast } from "./care-request-expiration.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { serializeDate } from "../utils/serialize-date.js";
import { toRegion } from "../utils/region.js";
import { getUniqueConstraintName } from "../utils/prisma-error.js";
import {
  validateUpdatedCareDates,
  type CareRequestQuotesHistoryQuery,
  type CreateCareRequestInput,
  type UpdateCareRequestInput,
  type ReceivedCareRequestsQuery,
} from "../validators/care-request-validator.js";

// 팟오너의 신규 돌봄 요청 생성
export async function createCareRequest(
  ownerId: bigint,
  careRequestData: CreateCareRequestInput,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  let initialOpenRequestId: bigint | null = null;

  const createInTransaction = () =>
    runTransaction(async (tx) => {
      const openRequest = await findOpenCareRequest(ownerId, tx);

      if (openRequest) {
        initialOpenRequestId = openRequest.id;

        const wasExpired = await expireCareRequestIfPast(openRequest, tx);

        if (!wasExpired) {
          throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
        }
      }

      return insertCareRequest(ownerId, careRequestData, tx);
    });

  try {
    try {
      return await createInTransaction();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
        throw error;
      }

      if (initialOpenRequestId === null) {
        throw error;
      }

      // 만료 처리 충돌 시 트랜잭션 밖에서 최초 조회한 요청과 현재 활성 요청을 재확인
      const refreshedRequest = await findCareRequest(initialOpenRequestId);

      if (!refreshedRequest || refreshedRequest.status === "OPEN") {
        throw error;
      }

      const latestOpenRequest = await findOpenCareRequest(ownerId);

      if (latestOpenRequest) {
        throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
      }

      return await createInTransaction();
    }
  } catch (error) {
    if (getUniqueConstraintName(error) === "CareRequest_one_open_per_owner_idx") {
      throw new AppError("ACTIVE_CARE_REQUEST_ALREADY_EXISTS");
    }

    throw error;
  }
}

// 팟오너의 활성 돌봄 요청 존재 여부 조회
// P2025 충돌 복구 테스트에서 만료 처리 함수를 주입하기 위해 매개변수화
export async function getActiveCareRequest(
  ownerId: bigint,
  expireCareRequestIfPastFn: typeof expireCareRequestIfPast = expireCareRequestIfPast,
) {
  const initialOpenRequest = await findOpenCareRequest(ownerId);

  if (!initialOpenRequest) {
    return null;
  }

  try {
    const wasExpired = await expireCareRequestIfPastFn(initialOpenRequest);

    return wasExpired ? null : initialOpenRequest;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    // 만료 처리 충돌 시 최초 조회한 요청과 현재 활성 요청을 재확인
    const refreshedRequest = await findCareRequest(initialOpenRequest.id);

    if (!refreshedRequest || refreshedRequest.status === "OPEN") {
      throw error;
    }

    const latestOpenRequest = await findOpenCareRequest(ownerId);

    if (!latestOpenRequest) {
      return null;
    }

    const wasExpired = await expireCareRequestIfPastFn(latestOpenRequest);

    return wasExpired ? null : latestOpenRequest;
  }
}

// 팟오너의 돌봄 요청 수정
export async function updateCareRequest(
  ownerId: bigint,
  careRequestId: bigint,
  careRequestData: UpdateCareRequestInput,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialRequest = await findCareRequest(careRequestId);

  if (!initialRequest) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  if (initialRequest.ownerId !== ownerId) {
    throw new AppError("FORBIDDEN");
  }

  try {
    const updatedRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequest(careRequestId, tx);

      if (!targetRequest || targetRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_STATUS_NOT_EDITABLE");
      }

      const wasExpired = await expireCareRequestIfPast(targetRequest, tx);

      if (wasExpired) {
        return null;
      }

      const hasReceivedQuote = Boolean(await findQuoteByCareRequestId(careRequestId, tx));

      if (hasReceivedQuote) {
        throw new AppError("CARE_REQUEST_EDIT_NOT_ALLOWED");
      }

      if (careRequestData.startDate !== undefined || careRequestData.endDate !== undefined) {
        // 날짜가 전달된 경우에만 유효성 검증
        const startDate = careRequestData.startDate ?? serializeDate(targetRequest.startDate);

        const endDate = careRequestData.endDate ?? serializeDate(targetRequest.endDate);

        validateUpdatedCareDates(startDate, endDate, careRequestData.startDate !== undefined);
      }

      const region =
        careRequestData.sido !== undefined ? toRegion(careRequestData.sido) : undefined;

      return updateOpenCareRequest(
        careRequestId,
        ownerId,
        {
          ...careRequestData,
          ...(region !== undefined && { region }),
        },
        tx,
      );
    });

    if (!updatedRequest) {
      throw new AppError("CARE_REQUEST_STATUS_NOT_EDITABLE");
    }

    return updatedRequest;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    const refreshedRequest = await findCareRequest(careRequestId);

    if (refreshedRequest && refreshedRequest.status !== "OPEN") {
      throw new AppError("CARE_REQUEST_STATUS_NOT_EDITABLE");
    }

    throw error;
  }
}

// 팟오너의 돌봄 요청 취소
export async function cancelCareRequestService(
  ownerId: bigint,
  careRequestId: bigint,
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const initialRequest = await findCareRequest(careRequestId);

  if (!initialRequest) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  if (initialRequest.ownerId !== ownerId) {
    throw new AppError("FORBIDDEN");
  }

  try {
    const canceledRequest = await runTransaction(async (tx) => {
      await lockCareRequestForUpdate(careRequestId, tx);

      const targetRequest = await findCareRequest(careRequestId, tx);

      if (!targetRequest) {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      if (targetRequest.status === "CANCELED") {
        throw new AppError("CARE_REQUEST_ALREADY_CANCELED");
      }

      if (targetRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }

      const wasExpired = await expireCareRequestIfPast(targetRequest, tx);

      if (wasExpired) {
        return null;
      }

      return cancelCareRequest(careRequestId, ownerId, tx);
    });

    if (!canceledRequest) {
      throw new AppError("CARE_REQUEST_NOT_FOUND");
    }

    return canceledRequest;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "P2025")) {
      throw error;
    }

    const refreshedRequest = await findCareRequest(careRequestId);

    if (refreshedRequest) {
      if (refreshedRequest.status === "CANCELED") {
        throw new AppError("CARE_REQUEST_ALREADY_CANCELED");
      }

      if (refreshedRequest.status !== "OPEN") {
        throw new AppError("CARE_REQUEST_NOT_FOUND");
      }
    }

    throw error;
  }
}

// 팟트너의 받은 공개·지정 돌봄 요청 목록 조회
export async function getReceivedCareRequests(sitterId: bigint, query: ReceivedCareRequestsQuery) {
  const sitterProfile = await findSitterProfileWithRegions(sitterId);

  if (!sitterProfile) {
    throw new AppError("FORBIDDEN");
  }

  const sitterRegions = sitterProfile.sitterServiceRegions.map(({ region }) => region);
  const today = new Date(`${getTodayInKst()}T00:00:00.000Z`);

  await expireReceivedCareRequests(sitterId, sitterRegions, today);

  const designatedRegions = await findReceivedDesignatedRequestRegions(sitterId, today);

  const availableRegions: Region[] = [
    ...new Set([...sitterRegions, ...designatedRegions.map(({ region }) => region)]),
  ];

  if (
    query.regions.some((region) => !availableRegions.includes(region)) ||
    (query.regions.length > 0 && query.regions.length >= availableRegions.length)
  ) {
    throw new AppError("INVALID_REGION");
  }

  const where: Prisma.CareRequestWhereInput = {
    status: CareRequestStatus.OPEN,
    startDate: { gte: today },
    quotes: {
      none: { sitterId },
    },
    designatedRequests: {
      none: {
        sitterId,
        rejectedRequest: { isNot: null },
      },
      ...(query.designatedOnly && {
        some: { sitterId },
      }),
    },
    OR: [
      {
        region: { in: sitterRegions },
        ignoredRequests: { none: { sitterId } },
      },
      {
        designatedRequests: { some: { sitterId } },
      },
    ],
    ...(query.serviceTypes.length > 0 && {
      serviceType: { in: query.serviceTypes },
    }),
    ...(query.regions.length > 0 && {
      region: { in: query.regions },
    }),
    ...(query.keyword && {
      owner: {
        nickname: { contains: query.keyword },
      },
    }),
  };

  const orderBy: Prisma.CareRequestOrderByWithRelationInput[] =
    query.sort === "START_DATE_ASC"
      ? [{ startDate: "asc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];

  const skip = (query.page - 1) * query.pageSize;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("INVALID_PAGE_PARAMETER");
  }

  const [totalCount, items] = await Promise.all([
    countReceivedCareRequests(where),
    findReceivedCareRequests(where, orderBy, skip, query.pageSize, sitterId),
  ]);

  return {
    items,
    availableRegions,
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / query.pageSize),
  };
}

// 팟오너의 진행 중인 돌봄 요청에 대한 견적 및 반려 현황 조회
export async function getOpenCareRequestQuotes(ownerId: bigint) {
  const openCareRequest = await getActiveCareRequest(ownerId);

  if (!openCareRequest) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  const careRequestQuoteOverview = await findOpenCareRequestQuotes(ownerId);

  if (!careRequestQuoteOverview) {
    throw new AppError("CARE_REQUEST_NOT_FOUND");
  }

  const designatedRequestIdBySitterId = new Map(
    careRequestQuoteOverview.designatedRequests.map((designatedRequest) => [
      designatedRequest.sitterId,
      designatedRequest.id,
    ]),
  );

  const rejectedDesignatedRequests = careRequestQuoteOverview.designatedRequests
    .flatMap((designatedRequest) => {
      const rejectedRequest = designatedRequest.rejectedRequest;

      if (!rejectedRequest) {
        return [];
      }

      return [
        {
          designatedRequestId: designatedRequest.id,
          sitterId: designatedRequest.sitterId,
          rejectedRequestId: rejectedRequest.id,
          createdAt: rejectedRequest.createdAt,
        },
      ];
    })

    .sort((firstRejectedRequest, secondRejectedRequest) => {
      const createdAtDifference =
        secondRejectedRequest.createdAt.getTime() - firstRejectedRequest.createdAt.getTime();

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      // 생성일이 같으면 반려 ID 내림차순으로 정렬 (중첩 삼항 연산자 대신 명시적 조건 분기)
      if (firstRejectedRequest.rejectedRequestId > secondRejectedRequest.rejectedRequestId) {
        return -1;
      }

      if (firstRejectedRequest.rejectedRequestId < secondRejectedRequest.rejectedRequestId) {
        return 1;
      }

      return 0;
    });

  // 견적 제출자와 반려한 팟트너의 ID를 중복 없이 수집
  const sitterIds = [
    ...new Set([
      ...careRequestQuoteOverview.quotes.map((quote) => quote.sitterId),
      ...rejectedDesignatedRequests.map((rejectedRequest) => rejectedRequest.sitterId),
    ]),
  ];

  const [sitterProfiles, sitterAggregates] = await Promise.all([
    findSitterProfilesForQuotes(sitterIds),
    getSitterAggregates(sitterIds),
  ]);

  const sitterProfileByUserId = new Map(
    sitterProfiles.map((sitterProfile) => [sitterProfile.userId, sitterProfile]),
  );

  function buildSitterResponse(sitterId: bigint) {
    const sitterProfile = sitterProfileByUserId.get(sitterId);

    if (!sitterProfile) {
      throw new AppError("SITTER_PROFILE_INCONSISTENT");
    }

    const sitterAggregate = sitterAggregates.get(sitterId);

    return {
      id: sitterId,
      nickname: sitterProfile.user.nickname,
      profileImageUrl: sitterProfile.profileImageUrl,
      gender: sitterProfile.gender,
      shortIntroduction: sitterProfile.shortIntroduction,
      averageRating: sitterAggregate?.averageRating ?? 0,
      reviewCount: sitterAggregate?.reviewCount ?? 0,
      confirmedQuoteCount: sitterAggregate?.confirmedQuoteCount ?? 0,
    };
  }

  return {
    careRequest: {
      id: careRequestQuoteOverview.id,
      createdAt: careRequestQuoteOverview.createdAt,
      serviceType: careRequestQuoteOverview.serviceType,
      startDate: serializeDate(careRequestQuoteOverview.startDate),
      endDate: serializeDate(careRequestQuoteOverview.endDate),
      sido: careRequestQuoteOverview.sido,
      sigungu: careRequestQuoteOverview.sigungu,
      bname: careRequestQuoteOverview.bname,
    },
    quotes: careRequestQuoteOverview.quotes.map((quote) => ({
      id: quote.id,
      designatedRequestId: designatedRequestIdBySitterId.get(quote.sitterId) ?? null,
      price: quote.price,
      createdAt: quote.createdAt,
      sitter: buildSitterResponse(quote.sitterId),
    })),
    rejectedRequests: rejectedDesignatedRequests.map((rejectedRequest) => ({
      rejectedRequestId: rejectedRequest.rejectedRequestId,
      designatedRequestId: rejectedRequest.designatedRequestId,
      createdAt: rejectedRequest.createdAt,
      sitter: buildSitterResponse(rejectedRequest.sitterId),
    })),
  };
}

// 팟오너의 돌봄 요청 이력과 해당 요청에 받은 견적 및 반려 조회
export async function getCareRequestQuotesHistoryByOwner(
  ownerId: bigint,
  query: CareRequestQuotesHistoryQuery,
) {
  if (query.cursor !== null) {
    const careRequestHistory = await findCareRequestHistory(ownerId, query.cursor);

    if (!careRequestHistory) {
      throw new AppError("INVALID_PAGE_PARAMETER");
    }
  }

  const careRequests = await findCareRequestQuotesHistoryByOwner(ownerId, query);

  const hasNext = careRequests.length > query.limit;
  const paginatedCareRequests = careRequests.slice(0, query.limit);

  // 돌봄 요청별 지정 요청 관계 및 반려 이력 구성
  const careRequestQuoteOverviews = paginatedCareRequests.map((careRequest) => {
    const designatedRequestIdBySitterId = new Map(
      careRequest.designatedRequests.map((designatedRequest) => [
        designatedRequest.sitterId,
        designatedRequest.id,
      ]),
    );

    const rejectedDesignatedRequests = careRequest.designatedRequests
      .flatMap((designatedRequest) => {
        const rejectedRequest = designatedRequest.rejectedRequest;

        if (!rejectedRequest) {
          return [];
        }

        return [
          {
            designatedRequestId: designatedRequest.id,
            sitterId: designatedRequest.sitterId,
            rejectedRequestId: rejectedRequest.id,
            createdAt: rejectedRequest.createdAt,
          },
        ];
      })
      .sort((firstRejectedRequest, secondRejectedRequest) => {
        const createdAtDifference =
          secondRejectedRequest.createdAt.getTime() - firstRejectedRequest.createdAt.getTime();

        if (createdAtDifference !== 0) {
          return createdAtDifference;
        }

        if (firstRejectedRequest.rejectedRequestId > secondRejectedRequest.rejectedRequestId) {
          return -1;
        }

        if (firstRejectedRequest.rejectedRequestId < secondRejectedRequest.rejectedRequestId) {
          return 1;
        }

        return 0;
      });

    return {
      careRequest,
      designatedRequestIdBySitterId,
      rejectedDesignatedRequests,
    };
  });

  // 견적 제출자와 반려 팟트너의 ID를 중복 없이 수집
  const sitterIds = [
    ...new Set([
      ...careRequestQuoteOverviews.flatMap(({ careRequest }) =>
        careRequest.quotes.map((quote) => quote.sitterId),
      ),
      ...careRequestQuoteOverviews.flatMap(({ rejectedDesignatedRequests }) =>
        rejectedDesignatedRequests.map((rejectedRequest) => rejectedRequest.sitterId),
      ),
    ]),
  ];

  // 팟트너 프로필 및 파생데이터 일괄 조회
  const [sitterProfiles, sitterAggregates] = await Promise.all([
    findSitterProfilesForQuotes(sitterIds),
    getSitterAggregates(sitterIds),
  ]);

  const sitterProfileByUserId = new Map(
    sitterProfiles.map((sitterProfile) => [sitterProfile.userId, sitterProfile]),
  );

  function buildSitterResponse(sitterId: bigint) {
    const sitterProfile = sitterProfileByUserId.get(sitterId);

    if (!sitterProfile) {
      throw new AppError("SITTER_PROFILE_INCONSISTENT");
    }

    const sitterAggregate = sitterAggregates.get(sitterId);

    return {
      id: sitterId,
      nickname: sitterProfile.user.nickname,
      profileImageUrl: sitterProfile.profileImageUrl,
      gender: sitterProfile.gender,
      shortIntroduction: sitterProfile.shortIntroduction,
      averageRating: sitterAggregate?.averageRating ?? 0,
      reviewCount: sitterAggregate?.reviewCount ?? 0,
      confirmedQuoteCount: sitterAggregate?.confirmedQuoteCount ?? 0,
    };
  }

  // 돌봄 요청별 견적·반려 응답 구성
  const items = careRequestQuoteOverviews.map(
    ({ careRequest, designatedRequestIdBySitterId, rejectedDesignatedRequests }) => ({
      careRequest: {
        id: careRequest.id,
        status: careRequest.status,
        confirmedQuoteId: careRequest.confirmedQuoteId,
        createdAt: careRequest.createdAt,
        serviceType: careRequest.serviceType,
        startDate: serializeDate(careRequest.startDate),
        endDate: serializeDate(careRequest.endDate),
        sido: careRequest.sido,
        sigungu: careRequest.sigungu,
        bname: careRequest.bname,
      },
      quotes: careRequest.quotes.map((quote) => ({
        id: quote.id,
        designatedRequestId: designatedRequestIdBySitterId.get(quote.sitterId) ?? null,
        price: quote.price,
        createdAt: quote.createdAt,
        sitter: buildSitterResponse(quote.sitterId),
      })),
      rejectedRequests: rejectedDesignatedRequests.map((rejectedRequest) => ({
        rejectedRequestId: rejectedRequest.rejectedRequestId,
        designatedRequestId: rejectedRequest.designatedRequestId,
        createdAt: rejectedRequest.createdAt,
        sitter: buildSitterResponse(rejectedRequest.sitterId),
      })),
    }),
  );

  return {
    items,
    nextCursor: hasNext ? paginatedCareRequests[paginatedCareRequests.length - 1]!.id : null,
    hasNext,
  };
}
