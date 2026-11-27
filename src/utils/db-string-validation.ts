// PostgreSQL 문자열에 허용되지 않는 NUL 문자 포함 여부 확인
export function containsNullByte(value: string): boolean {
  return value.includes("\0");
}
