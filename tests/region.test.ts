import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Region } from "../src/generated/prisma/enums.js";
import AppError from "../src/errors/app-error.js";
import { toRegion } from "../src/utils/region.js";

describe("toRegion", () => {
  const regionCases: {
    region: Region;
    sidoNames: string[];
  }[] = [
    { region: Region.SEOUL, sidoNames: ["서울", "서울특별시"] },
    { region: Region.GYEONGGI, sidoNames: ["경기", "경기도"] },
    { region: Region.INCHEON, sidoNames: ["인천", "인천광역시"] },
    {
      region: Region.GANGWON,
      sidoNames: ["강원", "강원도", "강원특별자치도"],
    },
    { region: Region.CHUNGBUK, sidoNames: ["충북", "충청북도"] },
    { region: Region.CHUNGNAM, sidoNames: ["충남", "충청남도"] },
    { region: Region.SEJONG, sidoNames: ["세종", "세종특별자치시"] },
    { region: Region.DAEJEON, sidoNames: ["대전", "대전광역시"] },
    {
      region: Region.JEONBUK,
      sidoNames: ["전북", "전라북도", "전북특별자치도"],
    },
    { region: Region.JEONNAM, sidoNames: ["전남", "전라남도"] },
    { region: Region.GWANGJU, sidoNames: ["광주", "광주광역시"] },
    { region: Region.GYEONGBUK, sidoNames: ["경북", "경상북도"] },
    { region: Region.GYEONGNAM, sidoNames: ["경남", "경상남도"] },
    { region: Region.DAEGU, sidoNames: ["대구", "대구광역시"] },
    { region: Region.ULSAN, sidoNames: ["울산", "울산광역시"] },
    { region: Region.BUSAN, sidoNames: ["부산", "부산광역시"] },
    {
      region: Region.JEJU,
      sidoNames: ["제주", "제주도", "제주특별자치도"],
    },
  ];

  it("17개 서비스 지역의 모든 명칭을 변환한다", () => {
    for (const { region, sidoNames } of regionCases) {
      for (const sido of sidoNames) {
        assert.equal(toRegion(sido), region);
      }
    }
  });

  it("모든 Region enum 값이 매핑 대상에 포함된다", () => {
    const mappedRegions = new Set(regionCases.map(({ region }) => region));

    assert.deepEqual([...mappedRegions].sort(), Object.values(Region).sort());
  });

  it("입력값의 앞뒤 공백을 제거한다", () => {
    assert.equal(toRegion(" 서울특별시 "), Region.SEOUL);
    assert.equal(toRegion("\t경기도\n"), Region.GYEONGGI);
  });

  it("빈 문자열과 공백만 있는 문자열은 거부한다", () => {
    for (const sido of ["", " ", "\t\n"]) {
      assertInvalidRegion(sido);
    }
  });

  it("정의되지 않은 지역명은 거부한다", () => {
    for (const sido of ["잘못된지역", "서울시", "SEOUL", "__proto__", "constructor"]) {
      assertInvalidRegion(sido);
    }
  });

  function assertInvalidRegion(sido: string) {
    assert.throws(
      () => toRegion(sido),
      (error: unknown) =>
        error instanceof AppError && error.code === "INVALID_REGION" && error.statusCode === 400,
    );
  }
});
