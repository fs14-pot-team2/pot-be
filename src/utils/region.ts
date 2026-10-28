import { Region } from "../generated/prisma/enums.js";
import AppError from "../errors/app-error.js";

// 카카오 우편번호 서비스의 sido → 내부 Region 매핑
const SIDO_TO_REGION = new Map<string, Region>([
  ["서울", Region.SEOUL],
  ["서울특별시", Region.SEOUL],

  ["경기", Region.GYEONGGI],
  ["경기도", Region.GYEONGGI],

  ["인천", Region.INCHEON],
  ["인천광역시", Region.INCHEON],

  ["강원", Region.GANGWON],
  ["강원도", Region.GANGWON],
  ["강원특별자치도", Region.GANGWON],

  ["충북", Region.CHUNGBUK],
  ["충청북도", Region.CHUNGBUK],

  ["충남", Region.CHUNGNAM],
  ["충청남도", Region.CHUNGNAM],

  ["세종", Region.SEJONG],
  ["세종특별자치시", Region.SEJONG],

  ["대전", Region.DAEJEON],
  ["대전광역시", Region.DAEJEON],

  ["전북", Region.JEONBUK],
  ["전라북도", Region.JEONBUK],
  ["전북특별자치도", Region.JEONBUK],

  ["전남", Region.JEONNAM],
  ["전라남도", Region.JEONNAM],

  ["광주", Region.GWANGJU],
  ["광주광역시", Region.GWANGJU],

  ["경북", Region.GYEONGBUK],
  ["경상북도", Region.GYEONGBUK],

  ["경남", Region.GYEONGNAM],
  ["경상남도", Region.GYEONGNAM],

  ["대구", Region.DAEGU],
  ["대구광역시", Region.DAEGU],

  ["울산", Region.ULSAN],
  ["울산광역시", Region.ULSAN],

  ["부산", Region.BUSAN],
  ["부산광역시", Region.BUSAN],

  ["제주", Region.JEJU],
  ["제주도", Region.JEJU],
  ["제주특별자치도", Region.JEJU],
]);

export function toRegion(sido: string): Region {
  const region = SIDO_TO_REGION.get(sido.trim());

  if (region === undefined) {
    throw new AppError("INVALID_REGION");
  }

  return region;
}
