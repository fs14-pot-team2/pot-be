import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { prisma } from "../src/config/prisma.js";
import AppError from "../src/errors/app-error.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { updateCareRequest } from "../src/services/care-request-service.js";
import {
  createDesignatedRequest,
  rejectDesignatedRequest,
} from "../src/services/designated-request-service.js";
import { updateSitterProfile } from "../src/services/profile-service.js";
import { createQuote } from "../src/services/quote-service.js";
import { getTodayInKst } from "../src/utils/kst-date.js";

// 테스트에 사용할 KST 기준 날짜
function futureDate(days: number) {
  const date = new Date(`${getTodayInKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
}

// Prisma P2025 충돌 오류 생성
function createP2025Error() {
  return Object.assign(new Error("Record not found"), {
    code: "P2025",
  });
}

// Prisma P2025 원본 오류 전달 확인
function assertP2025(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2025";
}

// Prisma P2002 UNIQUE 제약 충돌 오류 생성
function createP2002Error(constraintName?: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    ...(constraintName && {
      meta: {
        driverAdapterError: {
          cause: {
            constraint: {
              index: constraintName,
            },
          },
        },
      },
    }),
  });
}

// Prisma P2002 원본 오류 전달 확인
function assertP2002(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2002" &&
    !(error instanceof AppError)
  );
}

// 도메인 오류 코드와 HTTP 상태 코드 확인
function assertAppError(code: string, statusCode = 409) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

// 각 테스트에서 사용할 독립적인 팟오너, 돌봄 요청 및 팟트너 생성
async function createTestRequest(sitterCount = 2, startDate = futureDate(7)) {
  const uniqueId = randomUUID();

  const owner = await prisma.user.create({
    data: {
      email: `quote-owner-${uniqueId}@example.com`,
      nickname: `quote-owner-${uniqueId}`,
      passwordHash: "test-only",
      role: "OWNER",
      ownerProfile: { create: {} },
    },
  });

  const request = await prisma.careRequest.create({
    data: {
      ownerId: owner.id,
      serviceType: "SHORT_CARE",
      startDate,
      endDate: futureDate(14),
      zonecode: "04524",
      address: "서울특별시 중구 세종대로 110",
      detailAddress: "기존 상세 주소",
      sido: "서울특별시",
      sigungu: "중구",
      bname: null,
      region: "SEOUL",
      status: "OPEN",
    },
  });

  const sitters = await Promise.all(
    Array.from({ length: sitterCount }, (_, index) =>
      prisma.user.create({
        data: {
          email: `quote-sitter-${index}-${uniqueId}@example.com`,
          nickname: `quote-sitter-${index}-${uniqueId}`,
          passwordHash: "test-only",
          role: "SITTER",
          sitterProfile: {
            create: {
              gender: "FEMALE",
              shortIntroduction: "테스트용 팟트너",
              sitterServiceRegions: {
                create: [{ region: "SEOUL" }],
              },
            },
          },
        },
      }),
    ),
  );

  return {
    ownerId: owner.id,
    careRequestId: request.id,
    sitterIds: sitters.map((sitter) => sitter.id),
  };
}

const quotePrice = 10000;
const quoteComment = "테스트용 견적 내용입니다.";

describe("견적 생성", () => {
  describe("생성 조건", () => {
    // 공개 요청을 숨긴 팟트너도 지정 요청이 있으면 지역과 무관하게 견적을 생성하는지 확인
    it("공개 요청을 숨긴 팟트너도 지역과 무관하게 지정 견적을 생성한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      await updateSitterProfile(sitterId, {
        serviceRegions: ["INCHEON"],
      });

      await prisma.ignoredRequest.create({
        data: { careRequestId, sitterId },
      });

      await prisma.designatedRequest.create({
        data: { careRequestId, sitterId },
      });

      const createdQuote = await createQuote(sitterId, careRequestId, quotePrice, quoteComment);

      assert.equal(createdQuote.type, "DESIGNATED");

      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: { id: createdQuote.id },
      });

      assert.equal(savedQuote.type, "DESIGNATED");
      assert.equal(savedQuote.sitterId, sitterId);

      assert.equal(await prisma.ignoredRequest.count({ where: { careRequestId, sitterId } }), 1);
    });

    // 시작일이 지난 요청은 만료 처리 후 견적 생성을 차단하고 상태 변경을 커밋하는지 확인
    it("시작일이 지난 요청은 만료 처리 후 견적 생성을 차단한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest(2, futureDate(-1));

      await assert.rejects(
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment),
        assertAppError("QUOTE_EDIT_NOT_ALLOWED"),
      );

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(savedRequest.status, "EXPIRED");
      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
    });
  });

  describe("동시성 및 트랜잭션", () => {
    // 서로 다른 팟트너가 동시에 견적을 생성해도 일반 견적 5건 제한을 유지하는지 확인
    it("동시 견적 생성 시 일반 견적 최대 5건 제한을 유지한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest(6);

      const results = await Promise.allSettled(
        sitterIds.map((sitterId) => createQuote(sitterId, careRequestId, quotePrice, quoteComment)),
      );

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 5);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("GENERAL_QUOTE_LIMIT_EXCEEDED")(rejected[0].reason));

      assert.equal(await prisma.quote.count({ where: { careRequestId, type: "GENERAL" } }), 5);
    });

    // 동일 팟트너의 동시 견적 생성 시 하나만 성공하고 중복 생성을 방지하는지 확인
    it("동일 팟트너의 동시 견적 생성 시 중복 생성을 방지한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      const results = await Promise.allSettled([
        createQuote(sitterId, careRequestId, quotePrice, quoteComment),
        createQuote(sitterId, careRequestId, quotePrice, quoteComment),
      ]);

      const succeeded = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(succeeded.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(assertAppError("QUOTE_ALREADY_EXISTS")(rejected[0].reason));

      assert.equal(await prisma.quote.count({ where: { careRequestId, sitterId } }), 1);
    });

    // 돌봄 요청 수정과 견적 생성이 동시에 실행될 때 처리 순서에 따른 수정 여부 확인
    it("돌봄 요청 수정과 견적 생성이 동시에 실행되면 처리 순서에 따라 수정 여부를 결정한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();

      const [updateResult, quoteResult] = await Promise.allSettled([
        updateCareRequest(ownerId, careRequestId, {
          detailAddress: "경합 중 수정한 상세 주소",
        }),
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment),
      ]);

      assert.equal(quoteResult.status, "fulfilled");

      const savedRequest = await prisma.careRequest.findUniqueOrThrow({
        where: { id: careRequestId },
      });

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 1);

      if (updateResult.status === "fulfilled") {
        assert.equal(savedRequest.detailAddress, "경합 중 수정한 상세 주소");
      } else {
        assert.ok(assertAppError("CARE_REQUEST_EDIT_NOT_ALLOWED")(updateResult.reason));
        assert.equal(savedRequest.detailAddress, "기존 상세 주소");
      }
    });

    // 지정 요청 생성과 견적 생성이 동시에 실행될 때 처리 순서에 따른 견적 유형과 지정 여부 확인
    it("지정 요청 생성과 견적 생성이 동시에 실행되면 처리 순서에 따라 견적 유형을 결정한다", async () => {
      const { ownerId, careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      const [designatedResult, quoteResult] = await Promise.allSettled([
        createDesignatedRequest(ownerId, careRequestId, sitterId),
        createQuote(sitterId, careRequestId, quotePrice, quoteComment),
      ]);

      assert.equal(quoteResult.status, "fulfilled");

      const savedQuote = await prisma.quote.findUniqueOrThrow({
        where: {
          careRequestId_sitterId: { careRequestId, sitterId },
        },
      });

      const designatedCount = await prisma.designatedRequest.count({
        where: { careRequestId, sitterId },
      });

      if (designatedResult.status === "fulfilled") {
        assert.equal(designatedCount, 1);
        assert.equal(savedQuote.type, "DESIGNATED");
      } else {
        assert.ok(assertAppError("SITTER_ALREADY_SENT_QUOTE")(designatedResult.reason));
        assert.equal(designatedCount, 0);
        assert.equal(savedQuote.type, "GENERAL");
      }
    });

    // 지정 요청 반려와 견적 생성이 동시에 실행될 때 처리 순서에 따라 한 행위만 성공하는지 확인
    it("지정 요청 반려와 견적 생성이 동시에 실행되면 중복 처리를 방지한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      const designatedRequest = await prisma.designatedRequest.create({
        data: { careRequestId, sitterId },
      });

      const [rejectedResult, quoteResult] = await Promise.allSettled([
        rejectDesignatedRequest(
          sitterId,
          designatedRequest.id,
          "테스트용 지정 요청 반려 사유입니다.",
        ),
        createQuote(sitterId, careRequestId, quotePrice, quoteComment),
      ]);

      const quoteCount = await prisma.quote.count({
        where: { careRequestId, sitterId },
      });

      const rejectionCount = await prisma.rejectedRequest.count({
        where: { designatedRequestId: designatedRequest.id },
      });

      assert.equal(quoteCount + rejectionCount, 1);

      if (quoteResult.status === "fulfilled") {
        assert.equal(rejectedResult.status, "rejected");
        assert.ok(assertAppError("QUOTE_ALREADY_EXISTS")(rejectedResult.reason));
        assert.equal(quoteResult.value.type, "DESIGNATED");
      } else {
        assert.equal(rejectedResult.status, "fulfilled");
        assert.ok(assertAppError("DESIGNATED_REQUEST_NOT_FOUND", 404)(quoteResult.reason));
      }
    });

    // 서비스 지역 수정과 견적 생성이 동시에 실행될 때 처리 순서에 따른 견적 생성 여부와 지역 변경 결과 확인
    it("서비스 지역 수정과 견적 생성이 동시에 실행되면 처리 순서에 따라 생성 여부를 결정한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];

      const [profileResult, quoteResult] = await Promise.allSettled([
        updateSitterProfile(sitterId, {
          serviceRegions: ["INCHEON"],
        }),
        createQuote(sitterId, careRequestId, quotePrice, quoteComment),
      ]);

      assert.equal(profileResult.status, "fulfilled");

      const savedRegions = await prisma.sitterServiceRegion.findMany({
        where: { sitterProfile: { userId: sitterId } },
        select: { region: true },
      });

      assert.deepEqual(
        savedRegions.map(({ region }) => region),
        ["INCHEON"],
      );

      const quoteCount = await prisma.quote.count({
        where: { careRequestId, sitterId },
      });

      if (quoteResult.status === "fulfilled") {
        assert.equal(quoteResult.value.type, "GENERAL");
        assert.equal(quoteCount, 1);
      } else {
        assert.ok(assertAppError("CARE_REQUEST_NOT_FOUND", 404)(quoteResult.reason));
        assert.equal(quoteCount, 0);
      }
    });

    // 견적 생성 이후 트랜잭션이 실패하면 저장 결과가 롤백되는지 확인
    it("트랜잭션 실패 시 견적 생성을 롤백한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();
      const sitterId = sitterIds[0];
      const transactionError = new Error("Transaction failed");

      const runTransaction = <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await callback(tx);
          throw transactionError;
        });

      await assert.rejects(
        createQuote(sitterId, careRequestId, quotePrice, quoteComment, runTransaction),
        (error: unknown) => error === transactionError,
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId, sitterId } }), 0);
    });
  });

  describe("UNIQUE 제약 충돌 처리", () => {
    // P2002 견적 복합 UNIQUE 제약 충돌 시 중복 견적 도메인 오류 변환 확인
    it("P2002 발생 시 중복 견적 오류를 반환한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2002Error("Quote_careRequestId_sitterId_key");
      };

      await assert.rejects(
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment, runTransaction),
        assertAppError("QUOTE_ALREADY_EXISTS"),
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
    });

    // P2002 다른 UNIQUE 제약 충돌 시 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 다른 UNIQUE 제약이면 원본 Prisma 오류를 전달한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2002Error("User_email_role_key");
      };

      await assert.rejects(
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment, runTransaction),
        assertP2002,
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
    });

    // P2002 UNIQUE 제약 이름을 식별할 수 없으면 원본 Prisma 오류 유지 확인
    it("P2002 발생 시 UNIQUE 제약 이름이 없으면 원본 Prisma 오류를 전달한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2002Error();
      };

      await assert.rejects(
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment, runTransaction),
        assertP2002,
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
    });
  });

  describe("동시 상태 변경 충돌 복구", () => {
    // P2025 이후 최초 요청 상태가 변경됐다면 견적 불가 도메인 오류로 변환하는지 확인
    for (const status of ["EXPIRED", "MATCHED", "CANCELED"] as const) {
      it(`P2025 이후 최초 요청이 ${status} 상태면 견적 불가 오류를 반환한다`, async () => {
        const { careRequestId, sitterIds } = await createTestRequest();

        const runTransaction = async () => {
          await prisma.careRequest.update({
            where: { id: careRequestId },
            data: { status },
          });
          throw createP2025Error();
        };

        await assert.rejects(
          createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment, runTransaction),
          assertAppError("QUOTE_EDIT_NOT_ALLOWED"),
        );

        const savedRequest = await prisma.careRequest.findUniqueOrThrow({
          where: { id: careRequestId },
        });

        assert.equal(savedRequest.status, status);
        assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
      });
    }

    // P2025 이후 최초 요청이 OPEN 상태면 원본 Prisma 오류 유지 확인
    it("P2025 이후 최초 요청이 OPEN 상태면 원본 Prisma 오류를 전달한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();

      const runTransaction = async () => {
        throw createP2025Error();
      };

      await assert.rejects(
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment, runTransaction),
        assertP2025,
      );

      assert.equal(await prisma.quote.count({ where: { careRequestId } }), 0);
    });

    // P2025 이후 최초 요청이 삭제되면 원본 Prisma 오류 유지 확인
    it("P2025 이후 최초 요청이 삭제되면 원본 Prisma 오류를 전달한다", async () => {
      const { careRequestId, sitterIds } = await createTestRequest();

      const runTransaction = async () => {
        await prisma.careRequest.delete({
          where: { id: careRequestId },
        });
        throw createP2025Error();
      };

      await assert.rejects(
        createQuote(sitterIds[0], careRequestId, quotePrice, quoteComment, runTransaction),
        assertP2025,
      );

      assert.equal(await prisma.careRequest.findUnique({ where: { id: careRequestId } }), null);
    });
  });
});
