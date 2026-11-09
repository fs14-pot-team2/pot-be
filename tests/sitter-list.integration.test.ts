import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Gender, Region, ServiceType } from "../src/generated/prisma/enums.js";
import { getSitterList } from "../src/services/sitter-service.js";
import { validateSitterListQuery } from "../src/validators/sitter-validator.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 이번 테스트 실행에서 만든 팟트너만 골라내기 위한 고유 접두사
const PREFIX = `sl-${randomUUID().slice(0, 8)}`;

interface CreateSitterOptions {
  name: string;
  gender?: Gender;
  serviceTypes?: ServiceType[];
  serviceRegions?: Region[];
  withProfile?: boolean;
}

async function createSitter({
  name,
  gender = "FEMALE",
  serviceTypes = ["SHORT_CARE"],
  serviceRegions = ["SEOUL"],
  withProfile = true,
}: CreateSitterOptions) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${name}@example.com`,
      nickname: `${PREFIX}-${name}`,
      passwordHash: "test-only",
      role: "SITTER",
      ...(withProfile && {
        sitterProfile: {
          create: {
            gender,
            shortIntroduction: "테스트용 팟트너",
            sitterServices: { create: serviceTypes.map((serviceType) => ({ serviceType })) },
            sitterServiceRegions: { create: serviceRegions.map((region) => ({ region })) },
          },
        },
      }),
    },
  });
  return user.id;
}

// 평점 배열만큼 리뷰를 만든다. Review는 careRequest당 1개라 요청도 같이 생성한다.
async function addReviews(sitterId: bigint, ratings: number[]) {
  const ownerSuffix = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `${PREFIX}-owner-${ownerSuffix}@example.com`,
      nickname: `${PREFIX}-owner-${ownerSuffix}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  for (const rating of ratings) {
    const careRequest = await prisma.careRequest.create({
      data: {
        ownerId: owner.id,
        serviceType: "SHORT_CARE",
        startDate: futureDate(7),
        endDate: futureDate(14),
        zonecode: "04524",
        address: "서울특별시 중구 세종대로 110",
        sido: "서울특별시",
        sigungu: "중구",
        region: "SEOUL",
        status: "MATCHED",
      },
    });
    await prisma.review.create({
      data: {
        careRequestId: careRequest.id,
        ownerId: owner.id,
        sitterId,
        rating,
        content: "테스트 리뷰입니다.",
      },
    });
  }
}

async function addConfirmedQuotes(sitterId: bigint, count: number) {
  const ownerSuffix = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `${PREFIX}-qowner-${ownerSuffix}@example.com`,
      nickname: `${PREFIX}-qowner-${ownerSuffix}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  for (let i = 0; i < count; i++) {
    const careRequest = await prisma.careRequest.create({
      data: {
        ownerId: owner.id,
        serviceType: "SHORT_CARE",
        startDate: futureDate(7),
        endDate: futureDate(14),
        zonecode: "04524",
        address: "서울특별시 중구 세종대로 110",
        sido: "서울특별시",
        sigungu: "중구",
        region: "SEOUL",
        status: "MATCHED",
      },
    });
    const quote = await prisma.quote.create({
      data: {
        careRequestId: careRequest.id,
        sitterId,
        type: "GENERAL",
        price: 50000,
        comment: "테스트 견적입니다. 꼼꼼히 돌봐드립니다.",
      },
    });
    await prisma.careRequest.update({
      where: { id: careRequest.id },
      data: { confirmedQuoteId: quote.id },
    });
  }
}

// 이번 테스트의 팟트너만 대상으로 조회 (닉네임 접두사로 필터)
function listMine(query: Record<string, unknown> = {}) {
  return getSitterList(validateSitterListQuery({ keyword: PREFIX, ...query }));
}

function nicknamesOf(result: Awaited<ReturnType<typeof getSitterList>>) {
  return result.items.map((item) => item.nickname.replace(`${PREFIX}-`, ""));
}

function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("팟트너 찾기 목록 조회", () => {
  describe("응답 구조", () => {
    it("명세에 맞는 필드를 반환하고 description은 null이다", async () => {
      const userId = await createSitter({
        name: "shape",
        serviceTypes: ["SHORT_CARE", "REGULAR_CARE"],
        serviceRegions: ["SEOUL", "GYEONGGI"],
      });

      const result = await listMine({ keyword: `${PREFIX}-shape` });

      assert.equal(result.totalCount, 1);
      const [item] = result.items;
      assert.equal(item.id, userId.toString());
      assert.equal(item.nickname, `${PREFIX}-shape`);
      assert.equal(item.description, null);
      assert.deepEqual(item.serviceTypes.sort(), ["REGULAR_CARE", "SHORT_CARE"]);
      assert.deepEqual(item.serviceRegions.sort(), ["GYEONGGI", "SEOUL"]);
      assert.equal(item.averageRating, 0);
      assert.equal(item.reviewCount, 0);
      assert.equal(item.confirmedQuoteCount, 0);
    });

    it("팟트너 프로필이 없는 사용자는 목록에 나오지 않는다", async () => {
      await createSitter({ name: "noprofile", withProfile: false });

      const result = await listMine({ keyword: `${PREFIX}-noprofile` });

      assert.equal(result.totalCount, 0);
    });
  });

  describe("필터", () => {
    it("regions는 하나라도 겹치면 포함한다", async () => {
      await createSitter({ name: "f-seoul", serviceRegions: ["SEOUL"] });
      await createSitter({ name: "f-busan", serviceRegions: ["BUSAN"] });
      await createSitter({ name: "f-jeju", serviceRegions: ["JEJU"] });

      const result = await listMine({ regions: "SEOUL,BUSAN" });
      const names = nicknamesOf(result).filter((n) => n.startsWith("f-"));

      assert.deepEqual(names.sort(), ["f-busan", "f-seoul"]);
    });

    it("serviceTypes는 하나라도 겹치면 포함한다", async () => {
      await createSitter({ name: "s-short", serviceTypes: ["SHORT_CARE"] });
      await createSitter({ name: "s-regular", serviceTypes: ["REGULAR_CARE"] });

      const result = await listMine({ serviceTypes: "REGULAR_CARE" });
      const names = nicknamesOf(result).filter((n) => n.startsWith("s-"));

      assert.deepEqual(names, ["s-regular"]);
    });

    it("gender 복수 선택을 지원한다", async () => {
      await createSitter({ name: "g-male", gender: "MALE" });
      await createSitter({ name: "g-female", gender: "FEMALE" });

      const onlyMale = await listMine({ gender: "MALE" });
      assert.ok(nicknamesOf(onlyMale).includes("g-male"));
      assert.ok(!nicknamesOf(onlyMale).includes("g-female"));

      const both = await listMine({ gender: "MALE,FEMALE" });
      assert.ok(nicknamesOf(both).includes("g-male"));
      assert.ok(nicknamesOf(both).includes("g-female"));
    });

    it("keyword는 닉네임 부분 일치이며 대소문자를 구분하지 않는다", async () => {
      await createSitter({ name: "k-GreenHand" });

      const result = await listMine({ keyword: `${PREFIX}-k-greenhand` });

      assert.equal(result.totalCount, 1);
    });

    it("여러 필터는 AND로 적용된다", async () => {
      await createSitter({ name: "and-ok", gender: "MALE", serviceRegions: ["SEOUL"] });
      await createSitter({ name: "and-gender", gender: "FEMALE", serviceRegions: ["SEOUL"] });
      await createSitter({ name: "and-region", gender: "MALE", serviceRegions: ["BUSAN"] });

      const result = await listMine({ gender: "MALE", regions: "SEOUL" });
      const names = nicknamesOf(result).filter((n) => n.startsWith("and-"));

      assert.deepEqual(names, ["and-ok"]);
    });
  });

  describe("정렬", () => {
    it("평점 높은 순, 같으면 리뷰 수 많은 순, 그다음 userId 순으로 정렬한다", async () => {
      const sortPrefix = `${PREFIX}-sort`;
      const high = await createSitter({ name: "sort-high" }); // 평균 5.0, 리뷰 1
      const midMany = await createSitter({ name: "sort-mid-many" }); // 평균 4.0, 리뷰 2
      const midFew = await createSitter({ name: "sort-mid-few" }); // 평균 4.0, 리뷰 1
      const tieA = await createSitter({ name: "sort-tie-a" }); // 리뷰 없음
      const tieB = await createSitter({ name: "sort-tie-b" }); // 리뷰 없음

      await addReviews(high, [5]);
      await addReviews(midMany, [4, 4]);
      await addReviews(midFew, [4]);

      const result = await listMine({ keyword: sortPrefix });

      assert.deepEqual(
        result.items.map((item) => item.id),
        [high, midMany, midFew, tieA, tieB].map((id) => id.toString()),
      );
      // 동점 확인용: 마지막 두 명은 userId 오름차순
      assert.ok(tieA < tieB);
    });

    it("평균 평점은 소수 첫째 자리로 반올림된다", async () => {
      const userId = await createSitter({ name: "round" });
      await addReviews(userId, [5, 5, 4]); // 4.666... → 4.7

      const result = await listMine({ keyword: `${PREFIX}-round` });

      assert.equal(result.items[0].averageRating, 4.7);
      assert.equal(result.items[0].reviewCount, 3);
    });

    it("REVIEW_COUNT_DESC는 리뷰 많은 순, 같으면 평점 순, 그다음 userId 순이다", async () => {
      const many = await createSitter({ name: "rc-many" });
      const midHigh = await createSitter({ name: "rc-mid-high" });
      const midLow = await createSitter({ name: "rc-mid-low" });
      const few = await createSitter({ name: "rc-few" });
      const tieA = await createSitter({ name: "rc-tie-a" });
      const tieB = await createSitter({ name: "rc-tie-b" });

      await addReviews(many, [3, 3, 3]);
      await addReviews(midHigh, [5, 5]);
      await addReviews(midLow, [4, 4]);
      await addReviews(few, [5]);

      const result = await listMine({
        keyword: `${PREFIX}-rc-`,
        sort: "REVIEW_COUNT_DESC",
      });

      assert.deepEqual(
        result.items.map((item) => item.id),
        [many, midHigh, midLow, few, tieA, tieB].map((id) => id.toString()),
      );
    });

    it("CONFIRMED_QUOTE_COUNT_DESC는 확정 많은 순, 같으면 평점 → 리뷰 수 → userId 순이다", async () => {
      const most = await createSitter({ name: "cq-most" });
      const midHigh = await createSitter({ name: "cq-mid-high" });
      const midLow = await createSitter({ name: "cq-mid-low" });
      const none = await createSitter({ name: "cq-none" });

      await addConfirmedQuotes(most, 3);
      await addConfirmedQuotes(midHigh, 1);
      await addConfirmedQuotes(midLow, 1);
      await addReviews(midHigh, [5]);
      await addReviews(midLow, [3]);
      await addReviews(none, [5]);

      const result = await listMine({
        keyword: `${PREFIX}-cq-`,
        sort: "CONFIRMED_QUOTE_COUNT_DESC",
      });

      assert.deepEqual(
        result.items.map((item) => item.id),
        [most, midHigh, midLow, none].map((id) => id.toString()),
      );
      assert.deepEqual(
        result.items.map((item) => item.confirmedQuoteCount),
        [3, 1, 1, 0],
      );
    });

    it("sort를 생략하면 RATING_DESC로 정렬한다", async () => {
      const low = await createSitter({ name: "def-low" });
      const high = await createSitter({ name: "def-high" });
      await addReviews(low, [3, 3, 3]);
      await addReviews(high, [5]);

      const result = await listMine({ keyword: `${PREFIX}-def-` });

      assert.deepEqual(
        result.items.map((item) => item.id),
        [high, low].map((id) => id.toString()),
      );
    });
  });

  describe("페이지네이션", () => {
    it("page와 pageSize에 맞게 자르고 totalCount, totalPages를 계산한다", async () => {
      for (const name of ["p1", "p2", "p3", "p4", "p5"]) {
        await createSitter({ name: `page-${name}` });
      }

      const first = await listMine({ keyword: `${PREFIX}-page-`, page: "1", pageSize: "2" });
      const third = await listMine({ keyword: `${PREFIX}-page-`, page: "3", pageSize: "2" });
      const outOfRange = await listMine({ keyword: `${PREFIX}-page-`, page: "99", pageSize: "2" });

      assert.equal(first.items.length, 2);
      assert.equal(first.totalCount, 5);
      assert.equal(first.totalPages, 3);
      assert.equal(third.items.length, 1);
      assert.equal(outOfRange.items.length, 0);
      assert.equal(outOfRange.totalCount, 5);
    });

    it("페이지가 달라도 항목이 겹치거나 빠지지 않는다", async () => {
      const seen = new Set<string>();
      for (const page of ["1", "2", "3"]) {
        const result = await listMine({ keyword: `${PREFIX}-page-`, page, pageSize: "2" });
        for (const item of result.items) {
          assert.ok(!seen.has(item.id), "중복된 항목");
          seen.add(item.id);
        }
      }
      assert.equal(seen.size, 5);
    });
  });

  describe("쿼리 검증", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["잘못된 gender", { gender: "ABC" }, "INVALID_GENDER"],
      ["잘못된 regions", { regions: "SEOUL,XXX" }, "INVALID_REGION"],
      ["잘못된 serviceTypes", { serviceTypes: "LONG_CARE" }, "INVALID_SERVICE_TYPE"],
      ["pageSize 상한 초과", { pageSize: "101" }, "INVALID_PAGE_PARAMETER"],
      ["page 0", { page: "0" }, "INVALID_PAGE_PARAMETER"],
      ["page 문자", { page: "abc" }, "INVALID_PAGE_PARAMETER"],
      ["page 소수", { page: "1.5" }, "INVALID_PAGE_PARAMETER"],
      ["page 안전 정수 초과", { page: "9007199254740992" }, "INVALID_PAGE_PARAMETER"],
      ["page 앞자리 0", { page: "01" }, "INVALID_PAGE_PARAMETER"],
      ["잘못된 sort", { sort: "foo" }, "INVALID_REQUEST"],
      ["빈 문자열 sort", { sort: "" }, "INVALID_REQUEST"],
    ];

    for (const [title, query, code] of cases) {
      it(`${title}이면 ${code}를 반환한다`, () => {
        assert.throws(() => validateSitterListQuery(query), assertAppError(code));
      });
    }

    it("빈 문자열 필터는 무시한다", () => {
      const parsed = validateSitterListQuery({ keyword: "  ", regions: "", gender: "," });

      assert.equal(parsed.keyword, undefined);
      assert.equal(parsed.regions, undefined);
      assert.equal(parsed.genders, undefined);
      assert.equal(parsed.page, 1);
      assert.equal(parsed.pageSize, 8);
      assert.equal(parsed.sort, "RATING_DESC");
    });

    it("값이 중복되어도 한 번만 적용한다", () => {
      const parsed = validateSitterListQuery({ regions: "SEOUL,SEOUL,BUSAN" });

      assert.deepEqual(parsed.regions, ["SEOUL", "BUSAN"]);
    });
  });
});
