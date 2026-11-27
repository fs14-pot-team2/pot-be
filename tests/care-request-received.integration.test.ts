import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "pg";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import { expireReceivedCareRequests } from "../src/repositories/care-request-repository.js";
import { getReceivedCareRequests } from "../src/services/care-request-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";
import type { ReceivedCareRequestsQuery } from "../src/validators/care-request-validator.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 각 테스트에서 사용할 독립적인 팟트너 생성
async function createTestSitter(regions: Array<"SEOUL" | "GYEONGGI"> = ["SEOUL"]) {
  const uniqueId = randomUUID();
  const sitter = await prisma.user.create({
    data: {
      email: `received-sitter-${uniqueId}@example.com`,
      nickname: `received-sitter-${uniqueId}`,
      passwordHash: "test-only",
      role: "SITTER",
      sitterProfile: {
        create: {
          gender: "FEMALE",
          shortIntroduction: "테스트용 팟트너",
          sitterServiceRegions: { create: regions.map((region) => ({ region })) },
        },
      },
    },
  });
  return sitter.id;
}

// 각 테스트에서 사용할 독립적인 팟오너와 돌봄 요청 생성
async function createTestRequest(
  nicknamePrefix: string,
  options: {
    region?: "SEOUL" | "GYEONGGI" | "BUSAN";
    serviceType?: "SHORT_CARE" | "REGULAR_CARE";
    startDate?: string;
    status?: "OPEN" | "CANCELED" | "MATCHED" | "EXPIRED";
  } = {},
) {
  const uniqueId = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `received-owner-${uniqueId}@example.com`,
      nickname: `${nicknamePrefix}-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });
  const startDate = options.startDate ?? futureDate(7);
  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: options.serviceType ?? "SHORT_CARE",
      startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: new Date(`${futureDate(14)}T00:00:00.000Z`),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: "테스트 상세 주소",
      sido: "서울특별시",
      sigungu: "중구",
      bname: "태평로1가",
      region: options.region ?? "SEOUL",
      status: options.status ?? "OPEN",
    },
  });
  return { ownerId: owner.id, careRequestId: request.id };
}

// 다른 테스트 데이터와 구분하기 위한 닉네임 검색 조건 생성
function createQuery(
  keyword: string,
  overrides: Partial<ReceivedCareRequestsQuery> = {},
): ReceivedCareRequestsQuery {
  return {
    page: 1,
    pageSize: 100,
    serviceTypes: [],
    designatedOnly: false,
    regions: [],
    keyword,
    sort: "LATEST",
    ...overrides,
  };
}

function getIds(items: Awaited<ReturnType<typeof getReceivedCareRequests>>["items"]) {
  return items.map(({ id }) => id);
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("받은 요청 목록 조회", () => {
  describe("조회 조건", () => {
    // 서비스 가능 지역의 공개 요청과 지역 무관 지정 요청을 중복 없이 조회하는지 확인
    it("서비스 가능 지역의 공개 요청과 지역 외 지정 요청을 중복 없이 반환한다", async () => {
      const sitterId = await createTestSitter();
      const keyword = `received-public-${randomUUID()}`;
      const publicRequest = await createTestRequest(keyword);
      const outsideRequest = await createTestRequest(keyword, { region: "BUSAN" });
      const excludedRequest = await createTestRequest(keyword, { region: "GYEONGGI" });
      const designated = await prisma.designatedRequest.create({
        data: { careRequestId: outsideRequest.careRequestId, sitterId },
      });

      // 공개 요청과 지정 요청을 동시에 만족해도 1건만 반환해야 한다.
      const bothRequest = await createTestRequest(keyword);
      await prisma.designatedRequest.create({
        data: { careRequestId: bothRequest.careRequestId, sitterId },
      });

      const result = await getReceivedCareRequests(sitterId, createQuery(keyword));

      assert.equal(result.totalCount, 3);
      assert.deepEqual(
        new Set(getIds(result.items)),
        new Set([
          publicRequest.careRequestId,
          outsideRequest.careRequestId,
          bothRequest.careRequestId,
        ]),
      );
      assert.equal(getIds(result.items).includes(excludedRequest.careRequestId), false);
      assert.equal(result.items.length, new Set(getIds(result.items)).size);
      assert.deepEqual(new Set(result.availableRegions), new Set(["SEOUL", "BUSAN"]));
      assert.equal(
        result.items.find((item) => item.id === outsideRequest.careRequestId)?.designatedRequests[0]
          ?.id,
        designated.id,
      );
    });

    // 견적 제출·공개 숨김·지정 반려 요청 제외 및 숨긴 공개 요청의 지정 재노출 확인
    it("견적 제출·공개 숨김·지정 반려 요청은 제외하고 숨긴 공개 요청은 지정 시 다시 노출한다", async () => {
      const sitterId = await createTestSitter();
      const keyword = `received-exclude-${randomUUID()}`;
      const quoted = await createTestRequest(keyword);
      const ignored = await createTestRequest(keyword);
      const rejected = await createTestRequest(keyword);
      const revived = await createTestRequest(keyword);
      const visible = await createTestRequest(keyword);

      await prisma.quote.create({
        data: {
          careRequestId: quoted.careRequestId,
          sitterId,
          type: "GENERAL",
          price: 10000,
          comment: "견적 제출한 테스트 요청",
        },
      });

      await prisma.ignoredRequest.createMany({
        data: [ignored, revived].map(({ careRequestId }) => ({ careRequestId, sitterId })),
      });

      const rejectedDesignation = await prisma.designatedRequest.create({
        data: { careRequestId: rejected.careRequestId, sitterId },
      });

      await prisma.rejectedRequest.create({
        data: {
          designatedRequestId: rejectedDesignation.id,
          reason: "테스트 지정 요청 반려 사유",
        },
      });

      const revivedDesignation = await prisma.designatedRequest.create({
        data: { careRequestId: revived.careRequestId, sitterId },
      });

      const result = await getReceivedCareRequests(sitterId, createQuery(keyword));

      assert.deepEqual(
        new Set(getIds(result.items)),
        new Set([revived.careRequestId, visible.careRequestId]),
      );
      assert.equal(result.totalCount, 2);
      assert.equal(
        result.items.find((item) => item.id === revived.careRequestId)?.designatedRequests[0]?.id,
        revivedDesignation.id,
      );
    });

    // 만료 대상을 EXPIRED로 변경하고 비OPEN 요청은 목록에서 제외하는지 확인
    it("시작일이 지난 OPEN 요청은 만료 처리하고 목록에서 제외한다", async () => {
      const sitterId = await createTestSitter();
      const keyword = `received-expire-${randomUUID()}`;
      const expired = await createTestRequest(keyword, { startDate: futureDate(-1) });
      const canceled = await createTestRequest(keyword, { status: "CANCELED" });
      const active = await createTestRequest(keyword);

      const result = await getReceivedCareRequests(sitterId, createQuery(keyword));

      assert.deepEqual(getIds(result.items), [active.careRequestId]);
      assert.equal(result.totalCount, 1);
      assert.equal(
        (
          await prisma.careRequest.findUniqueOrThrow({
            where: { id: expired.careRequestId },
          })
        ).status,
        "EXPIRED",
      );
      assert.equal(
        (
          await prisma.careRequest.findUniqueOrThrow({
            where: { id: canceled.careRequestId },
          })
        ).status,
        "CANCELED",
      );
    });

    // 검색·필터·정렬·페이지 조건과 독립적으로 지역 선택지를 구성하는지 확인
    it("지역 선택지는 검색·필터 및 페이지네이션 조건과 독립적으로 구성한다", async () => {
      const sitterId = await createTestSitter(["SEOUL", "GYEONGGI"]);
      const keyword = `received-filter-${randomUUID()}`;
      const first = await createTestRequest(keyword, {
        region: "SEOUL",
        serviceType: "SHORT_CARE",
      });

      await createTestRequest(keyword, {
        region: "GYEONGGI",
        serviceType: "REGULAR_CARE",
      });

      const outside = await createTestRequest(keyword, { region: "BUSAN" });

      await prisma.designatedRequest.create({
        data: { careRequestId: outside.careRequestId, sitterId },
      });

      const result = await getReceivedCareRequests(
        sitterId,
        createQuery(keyword, {
          serviceTypes: ["SHORT_CARE"],
          regions: ["SEOUL"],
          pageSize: 1,
        }),
      );

      assert.deepEqual(getIds(result.items), [first.careRequestId]);
      assert.equal(result.totalCount, 1);
      assert.equal(result.totalPages, 1);
      assert.deepEqual(new Set(result.availableRegions), new Set(["SEOUL", "GYEONGGI", "BUSAN"]));

      const designatedOnly = await getReceivedCareRequests(
        sitterId,
        createQuery(keyword, {
          designatedOnly: true,
          pageSize: 1,
        }),
      );

      assert.deepEqual(getIds(designatedOnly.items), [outside.careRequestId]);
    });

    const regionAdjustmentScenarios: {
      name: string;
      regions: ReceivedCareRequestsQuery["regions"];
      expectedPage: number;
      expectedTotalCount: number;
    }[] = [
      {
        name: "지역 미선택 시 전체 조회 및 요청 페이지를 유지한다",
        regions: [],
        expectedPage: 2,
        expectedTotalCount: 3,
      },
      {
        name: "유효한 일부 지역 선택 시 지역 조건 및 요청 페이지를 유지한다",
        regions: ["SEOUL"],
        expectedPage: 2,
        expectedTotalCount: 2,
      },
      {
        name: "일부 지역이 유효하지 않으면 해당 지역을 제외하고 첫 페이지를 반환한다",
        regions: ["SEOUL", "BUSAN"],
        expectedPage: 1,
        expectedTotalCount: 2,
      },
      {
        name: "선택한 지역이 모두 유효하지 않으면 전체 조회의 첫 페이지를 반환한다",
        regions: ["BUSAN"],
        expectedPage: 1,
        expectedTotalCount: 3,
      },
      {
        name: "최신 유효 지역 전체를 선택하면 전체 조회의 첫 페이지를 반환한다",
        regions: ["SEOUL", "GYEONGGI"],
        expectedPage: 1,
        expectedTotalCount: 3,
      },
      {
        name: "지역 보정 후 전체 선택에 해당하면 전체 조회의 첫 페이지를 반환한다",
        regions: ["SEOUL", "GYEONGGI", "BUSAN"],
        expectedPage: 1,
        expectedTotalCount: 3,
      },
    ];

    for (const scenario of regionAdjustmentScenarios) {
      // 지역 선택 조건별 보정 결과와 실제 조회 목록 및 페이지네이션 정보 확인
      it(scenario.name, async () => {
        const sitterId = await createTestSitter(["SEOUL", "GYEONGGI"]);
        const keyword = `received-region-adjust-${randomUUID()}`;

        const first = await createTestRequest(keyword, {
          region: "SEOUL",
          startDate: futureDate(2),
        });

        const second = await createTestRequest(keyword, {
          region: "SEOUL",
          startDate: futureDate(3),
        });

        await createTestRequest(keyword, {
          region: "GYEONGGI",
          startDate: futureDate(4),
        });

        const result = await getReceivedCareRequests(
          sitterId,
          createQuery(keyword, {
            regions: scenario.regions,
            page: 2,
            pageSize: 1,
            sort: "START_DATE_ASC",
          }),
        );

        assert.deepEqual(getIds(result.items), [
          scenario.expectedPage === 1 ? first.careRequestId : second.careRequestId,
        ]);
        assert.deepEqual(new Set(result.availableRegions), new Set(["SEOUL", "GYEONGGI"]));
        assert.equal(result.page, scenario.expectedPage);
        assert.equal(result.totalCount, scenario.expectedTotalCount);
      });
    }

    const regionValidityScenarios = [
      { action: "QUOTE", name: "견적 제출" },
      { action: "REJECT", name: "지정 요청 반려" },
      { action: "CANCEL", name: "돌봄 요청 취소" },
      { action: "EXPIRE", name: "돌봄 요청 만료" },
      { action: "MATCH", name: "다른 팟트너와 매칭 완료" },
    ] as const;

    for (const scenario of regionValidityScenarios) {
      // 동일 지역의 유효한 지정 요청이 남아 있으면 지역을 유지하고 마지막 요청 무효화 시 제외하는지 확인
      it(`${scenario.name} 이후 유효한 지정 요청의 존재 여부에 따라 지역을 유지하거나 제외한다`, async () => {
        const sitterId = await createTestSitter(["SEOUL", "GYEONGGI"]);
        const keyword = `received-region-change-${randomUUID()}`;

        const publicRequest = await createTestRequest(keyword);
        const designatedRequests = [];

        for (let index = 0; index < 2; index++) {
          const request = await createTestRequest(keyword, {
            region: "BUSAN",
          });

          const designation = await prisma.designatedRequest.create({
            data: {
              careRequestId: request.careRequestId,
              sitterId,
            },
          });

          designatedRequests.push(designation);
        }

        const query = createQuery(keyword, {
          regions: ["BUSAN"],
          page: 2,
          pageSize: 1,
        });

        const initialResult = await getReceivedCareRequests(sitterId, query);

        assert.deepEqual(
          new Set(initialResult.availableRegions),
          new Set(["SEOUL", "GYEONGGI", "BUSAN"]),
        );
        assert.equal(initialResult.page, 2);

        for (const [index, designation] of designatedRequests.entries()) {
          const { id, careRequestId } = designation;

          switch (scenario.action) {
            case "QUOTE":
              await prisma.quote.create({
                data: {
                  careRequestId,
                  sitterId,
                  type: "DESIGNATED",
                  price: 10000,
                  comment: "테스트 지정 요청 견적 제출",
                },
              });
              break;

            case "REJECT":
              await prisma.rejectedRequest.create({
                data: {
                  designatedRequestId: id,
                  reason: "테스트 지정 요청 반려 사유",
                },
              });
              break;

            case "CANCEL":
              await prisma.careRequest.update({
                where: { id: careRequestId },
                data: {
                  status: "CANCELED",
                  canceledAt: new Date(),
                },
              });
              break;

            case "EXPIRE":
              await prisma.careRequest.update({
                where: { id: careRequestId },
                data: {
                  startDate: new Date(`${futureDate(-1)}T00:00:00.000Z`),
                },
              });
              break;

            case "MATCH": {
              const otherSitterId = await createTestSitter();

              await prisma.designatedRequest.create({
                data: {
                  careRequestId,
                  sitterId: otherSitterId,
                },
              });

              const quote = await prisma.quote.create({
                data: {
                  careRequestId,
                  sitterId: otherSitterId,
                  type: "DESIGNATED",
                  price: 10000,
                  comment: "다른 팟트너의 테스트 견적",
                },
              });

              await prisma.careRequest.update({
                where: { id: careRequestId },
                data: {
                  status: "MATCHED",
                  confirmedQuoteId: quote.id,
                },
              });
              break;
            }
          }

          const result = await getReceivedCareRequests(sitterId, query);

          if (index === 0) {
            assert.deepEqual(
              new Set(result.availableRegions),
              new Set(["SEOUL", "GYEONGGI", "BUSAN"]),
            );
            assert.equal(result.page, 2);
          } else {
            assert.deepEqual(new Set(result.availableRegions), new Set(["SEOUL", "GYEONGGI"]));
            assert.equal(result.page, 1);
            assert.deepEqual(getIds(result.items), [publicRequest.careRequestId]);
          }
        }
      });
    }

    // 지역 조건 보정 이후에도 기존 검색·필터·정렬 조건을 유지하는지 확인
    it("지역 조건 보정 이후에도 기존 검색·필터·정렬 조건을 유지한다", async () => {
      const sitterId = await createTestSitter(["SEOUL", "GYEONGGI"]);
      const keyword = `received-adjusted-filter-${randomUUID()}`;

      const second = await createTestRequest(keyword, {
        startDate: futureDate(4),
      });
      const first = await createTestRequest(keyword, {
        startDate: futureDate(3),
      });
      const regular = await createTestRequest(keyword, {
        serviceType: "REGULAR_CARE",
      });
      const outsideKeyword = await createTestRequest(`received-other-${randomUUID()}`);
      const outsideRegion = await createTestRequest(keyword, {
        region: "GYEONGGI",
      });

      await createTestRequest(keyword);

      await prisma.designatedRequest.createMany({
        data: [first, second, regular, outsideKeyword, outsideRegion].map(({ careRequestId }) => ({
          careRequestId,
          sitterId,
        })),
      });

      const result = await getReceivedCareRequests(
        sitterId,
        createQuery(keyword, {
          regions: ["SEOUL", "BUSAN"],
          serviceTypes: ["SHORT_CARE"],
          designatedOnly: true,
          sort: "START_DATE_ASC",
          page: 2,
          pageSize: 2,
        }),
      );

      assert.deepEqual(getIds(result.items), [first.careRequestId, second.careRequestId]);
      assert.equal(result.totalCount, 2);
    });
  });

  describe("정렬 및 페이지네이션", () => {
    // 지역 조건 보정 시 최종 적용 페이지를 기준으로 페이지네이션을 계산하는지 확인
    it("지역 조건 보정 시 최종 페이지를 기준으로 페이지네이션을 계산한다", async () => {
      const sitterId = await createTestSitter();
      const keyword = `received-pagination-adjust-${randomUUID()}`;
      const request = await createTestRequest(keyword);

      const result = await getReceivedCareRequests(
        sitterId,
        createQuery(keyword, {
          regions: ["BUSAN"],
          page: Number.MAX_SAFE_INTEGER,
          pageSize: 2,
        }),
      );

      assert.equal(result.page, 1);
      assert.deepEqual(getIds(result.items), [request.careRequestId]);
    });

    // 지역 조건 보정이 없으면 기존 페이지네이션 안전한 정수 범위 검증을 유지하는지 확인
    it("skip이 안전한 정수 범위를 벗어나면 INVALID_PAGE_PARAMETER를 반환한다", async () => {
      const sitterId = await createTestSitter();
      const keyword = `received-pagination-invalid-${randomUUID()}`;

      await assert.rejects(
        getReceivedCareRequests(
          sitterId,
          createQuery(keyword, {
            page: Number.MAX_SAFE_INTEGER,
            pageSize: 2,
          }),
        ),
        assertAppError("INVALID_PAGE_PARAMETER", 400),
      );
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // 별도 트랜잭션에서 CANCELED로 변경한 요청을 만료 처리가 EXPIRED로 덮어쓰지 않는지 확인
    it("만료 처리 중 요청이 CANCELED로 변경되면 해당 상태를 유지한다", async () => {
      const sitterId = await createTestSitter();
      const request = await createTestRequest(`received-race-${randomUUID()}`, {
        startDate: futureDate(-1),
      });

      const connectionString = process.env.DATABASE_URL;
      assert.ok(connectionString, "DATABASE_URL이 필요합니다.");

      const client = new Client({ connectionString });
      await client.connect();

      try {
        await client.query("BEGIN");
        await client.query('SELECT id FROM "CareRequest" WHERE id = $1 FOR UPDATE', [
          request.careRequestId,
        ]);

        const today = new Date(`${getTodayInKst()}T00:00:00.000Z`);
        const pendingExpiration = expireReceivedCareRequests(sitterId, ["SEOUL"], today);

        await client.query('UPDATE "CareRequest" SET status = $2 WHERE id = $1', [
          request.careRequestId,
          "CANCELED",
        ]);
        await client.query("COMMIT");

        const updateResult = await pendingExpiration;
        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: request.careRequestId },
        });

        assert.equal(updateResult.count, 0);
        assert.equal(savedRequest.status, "CANCELED");
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    });
  });
});
