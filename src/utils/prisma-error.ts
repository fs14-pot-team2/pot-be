// P2002 오류에서 충돌한 UNIQUE 제약 이름 추출
export function getUniqueConstraintName(error: unknown): string | null {
  if (!(error instanceof Error && "code" in error && error.code === "P2002")) {
    return null;
  }

  const constraintName = (
    error as {
      meta?: {
        driverAdapterError?: {
          cause?: {
            constraint?: {
              index?: string;
            };
          };
        };
      };
    }
  ).meta?.driverAdapterError?.cause?.constraint?.index;

  return typeof constraintName === "string" ? constraintName : null;
}
