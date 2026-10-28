const BIGINT_MAX = 9223372036854775807n;

export function parseBigId(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const id = BigInt(value);
  return id <= BIGINT_MAX ? id : null;
}

export function serializeBigInt<T>(data: T): unknown {
  return JSON.parse(
    JSON.stringify(data, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}
