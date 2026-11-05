import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Gender, Region, ServiceType } from "../src/generated/prisma/enums.js";
import { getSitterDetail } from "../src/services/sitter-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";
import { validateSitterIdParam } from "../src/validators/sitter-validator.js";

function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// 이번 테스트 실행에서 만든 데이터만 구분하기 위함
const PREFIX = `sd-${randomUUID().slice(0, 8)}`;

interface CreateSitterOptions {
  name: string;
  gender?: Gender;
  description?: string;
  serviceTypes?: ServiceType[];
  serviceRegions?: Region[];
  withProfile?: boolean;
}

async function createSitter({
  name,
  gender = "FEMALE",
  description = "테스트용 상세 설명",
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
            description,
            sitterServices: { create: serviceTypes.map((serviceType) => ({ serviceType })) },
            sitterServiceRegions: { create: serviceRegions.map((region) => ({ region })) },
          },
        },
      }),
    },
  });
  return user.id;
}

interface CreateOwnerOptions {
  name: string;
  withActiveRequest?: boolean;
}

// 팟오너와 (선택적으로) 활성 돌봄 요청을 만든다.
async function createOwner({ name, withActiveRequest = true }: CreateOwnerOptions) {
  const owner = await prisma.user.create({
    data: {
      email: `${PREFIX}-${name}@example.com`,
      nickname: `${PREFIX}-${name}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const careRequest = withActiveRequest
    ? await prisma.careRequest.create({
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
          status: "OPEN",
        },
      })
    : null;

  return { ownerId: owner.id, careRequestId: careRequest?.id ?? null };
}

// 평점 배열만큼 리뷰를 만든다. Review는 careRequest당 1개라 요청도 같이 생성한다.
async function addReviews(sitterId: bigint, ratings: number[]) {
  const ownerSuffix = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `${PREFIX}-reviewer-${ownerSuffix}@example.com`,
      nickname: `${PREFIX}-reviewer-${ownerSuffix}`,
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

function assertAppError(code: string, statusCode = 400) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

describe("팟트너 상세 조회", () => {
  describe("응답 구조", () => {
    it("명세에 맞는 필드를 반환하고 description을 포함한다", async () => {
      const userId = await createSitter({
        name: "shape",
        description: "식물별 관리 방법을 확인하고 꼼꼼하게 돌봅니다.",
        serviceTypes: ["SHORT_CARE", "REGULAR_CARE"],
        serviceRegions: ["SEOUL", "GYEONGGI"],
      });

      const result = await getSitterDetail(userId);

      assert.equal(result.id, userId.toString());
      assert.equal(result.nickname, `${PREFIX}-shape`);
      assert.equal(result.profileImageUrl, null);
      assert.equal(result.gender, "FEMALE");
      assert.equal(result.shortIntroduction, "테스트용 팟트너");
      assert.equal(result.description, "식물별 관리 방법을 확인하고 꼼꼼하게 돌봅니다.");
      assert.deepEqual(result.serviceTypes.sort(), ["REGULAR_CARE", "SHORT_CARE"]);
      assert.deepEqual(result.serviceRegions.sort(), ["GYEONGGI", "SEOUL"]);
      assert.equal(result.averageRating, 0);
      assert.equal(result.reviewCount, 0);
      assert.equal(result.confirmedQuoteCount, 0);
    });

    it("리뷰가 있으면 평균 평점과 리뷰 수가 반영된다", async () => {
      const userId = await createSitter({ name: "rating" });
      await addReviews(userId, [5, 5, 4]); // 4.666... → 4.7

      const result = await getSitterDetail(userId);

      assert.equal(result.averageRating, 4.7);
      assert.equal(result.reviewCount, 3);
    });
  });

  describe("조회 대상", () => {
    it("존재하지 않는 팟트너는 SITTER_NOT_FOUND를 반환한다", async () => {
      await assert.rejects(
        () => getSitterDetail(999999999999n),
        assertAppError("SITTER_NOT_FOUND", 404),
      );
    });

    it("팟트너 프로필이 없는 사용자는 SITTER_NOT_FOUND를 반환한다", async () => {
      const userId = await createSitter({ name: "noprofile", withProfile: false });

      await assert.rejects(() => getSitterDetail(userId), assertAppError("SITTER_NOT_FOUND", 404));
    });
  });

  describe("조회 권한", () => {
    it("비로그인은 조회할 수 있고 designatedRequestStatus는 null이다", async () => {
      const userId = await createSitter({ name: "guest" });

      const result = await getSitterDetail(userId);

      assert.equal(result.designatedRequestStatus, null);
    });

    it("로그인한 팟트너는 SITTER_PROFILE_ACCESS_FORBIDDEN을 반환한다", async () => {
      const targetId = await createSitter({ name: "auth-target" });
      const viewerId = await createSitter({ name: "auth-viewer" });

      await assert.rejects(
        () => getSitterDetail(targetId, { id: viewerId, role: "SITTER" }),
        assertAppError("SITTER_PROFILE_ACCESS_FORBIDDEN", 403),
      );
    });
  });

  describe("designatedRequestStatus", () => {
    it("활성 돌봄 요청이 없으면 NO_ACTIVE_REQUEST", async () => {
      const sitterId = await createSitter({ name: "st-none-sitter" });
      const { ownerId } = await createOwner({ name: "st-none-owner", withActiveRequest: false });

      const result = await getSitterDetail(sitterId, { id: ownerId, role: "OWNER" });

      assert.equal(result.designatedRequestStatus, "NO_ACTIVE_REQUEST");
    });

    it("활성 돌봄 요청이 있고 지정 가능하면 AVAILABLE", async () => {
      const sitterId = await createSitter({ name: "st-avail-sitter" });
      const { ownerId } = await createOwner({ name: "st-avail-owner" });

      const result = await getSitterDetail(sitterId, { id: ownerId, role: "OWNER" });

      assert.equal(result.designatedRequestStatus, "AVAILABLE");
    });

    it("이미 지정한 팟트너면 ALREADY_DESIGNATED", async () => {
      const sitterId = await createSitter({ name: "st-already-sitter" });
      const { ownerId, careRequestId } = await createOwner({ name: "st-already-owner" });
      await prisma.designatedRequest.create({
        data: { careRequestId: careRequestId!, sitterId },
      });

      const result = await getSitterDetail(sitterId, { id: ownerId, role: "OWNER" });

      assert.equal(result.designatedRequestStatus, "ALREADY_DESIGNATED");
    });

    it("지정 요청 3명을 모두 썼으면 다른 팟트너는 LIMIT_EXCEEDED", async () => {
      const targetId = await createSitter({ name: "st-limit-target" });
      const { ownerId, careRequestId } = await createOwner({ name: "st-limit-owner" });
      for (const name of ["st-limit-a", "st-limit-b", "st-limit-c"]) {
        const designatedSitterId = await createSitter({ name });
        await prisma.designatedRequest.create({
          data: { careRequestId: careRequestId!, sitterId: designatedSitterId },
        });
      }

      const result = await getSitterDetail(targetId, { id: ownerId, role: "OWNER" });

      assert.equal(result.designatedRequestStatus, "LIMIT_EXCEEDED");
    });

    it("해당 팟트너가 이미 견적을 보냈으면 ALREADY_SENT_QUOTE", async () => {
      const sitterId = await createSitter({ name: "st-quote-sitter" });
      const { ownerId, careRequestId } = await createOwner({ name: "st-quote-owner" });
      await prisma.quote.create({
        data: {
          careRequestId: careRequestId!,
          sitterId,
          type: "GENERAL",
          price: 50000,
          comment: "정성껏 돌봐드릴게요.",
        },
      });

      const result = await getSitterDetail(sitterId, { id: ownerId, role: "OWNER" });

      assert.equal(result.designatedRequestStatus, "ALREADY_SENT_QUOTE");
    });

    it("지정 한도를 다 썼어도 이미 지정한 팟트너는 ALREADY_DESIGNATED가 우선한다", async () => {
      const { ownerId, careRequestId } = await createOwner({ name: "st-prio-owner" });
      const designatedIds: bigint[] = [];
      for (const name of ["st-prio-a", "st-prio-b", "st-prio-c"]) {
        const sitterId = await createSitter({ name });
        designatedIds.push(sitterId);
        await prisma.designatedRequest.create({
          data: { careRequestId: careRequestId!, sitterId },
        });
      }

      const result = await getSitterDetail(designatedIds[0], { id: ownerId, role: "OWNER" });

      assert.equal(result.designatedRequestStatus, "ALREADY_DESIGNATED");
    });
  });

  describe("ID 검증", () => {
    const invalidIds: Array<[string, unknown]> = [
      ["문자", "abc"],
      ["0", "0"],
      ["음수", "-1"],
      ["소수", "1.5"],
      ["빈 문자열", ""],
      ["값 없음", undefined],
      ["BigInt 범위 초과", "9223372036854775808"],
    ];

    for (const [title, value] of invalidIds) {
      it(`${title}이면 INVALID_ID를 반환한다`, () => {
        assert.throws(() => validateSitterIdParam(value), assertAppError("INVALID_ID"));
      });
    }

    it("정상 ID는 bigint로 변환한다", () => {
      assert.equal(validateSitterIdParam("12"), 12n);
    });
  });
});
