/**
 * KST(한국 표준시) 기준 날짜 계산 공통 유틸
 *
 * 재사용 범위
 * - 돌봄 요청 생성·수정: 시작일이 KST 기준 미래인지 검증
 * - 돌봄 요청 만료 처리: OPEN 요청의 시작일 경과 여부 판단
 * - 활성 돌봄 요청 조회: 만료 대상 요청의 상태 판단
 * - 리뷰 작성: 돌봄 종료일 경과 여부 판단
 *
 * 주의사항
 * - 날짜 비교를 위한 YYYY-MM-DD 문자열 반환
 * - DB 저장 및 API 응답의 UTC 일시 변환·포맷팅에는 사용하지 않음
 */

export function getTodayInKst(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}
