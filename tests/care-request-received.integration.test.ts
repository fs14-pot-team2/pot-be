import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "pg";

import { prisma } from "../src/config/prisma.js";
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
