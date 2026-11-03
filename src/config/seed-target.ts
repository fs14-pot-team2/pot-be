const LOCAL_SEED_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOCAL_DATABASE_NAME = "pot";
const DEVELOPMENT_DATABASE_NAME = "pot_dev";
const RDS_HOST_SUFFIX = ".rds.amazonaws.com";

export type SeedTarget = {
  kind: "local" | "development-rds";
  databaseName: typeof LOCAL_DATABASE_NAME | typeof DEVELOPMENT_DATABASE_NAME;
  hostname: string;
};

type SeedTargetInput = {
  databaseUrl: string | undefined;
  potDevRdsHost: string | undefined;
  potDevSeedConfirmation: string | undefined;
};

export function assertAllowedSeedTarget({
  databaseUrl,
  potDevRdsHost,
  potDevSeedConfirmation,
}: SeedTargetInput): SeedTarget {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL 형식이 올바르지 않습니다.");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("PostgreSQL DATABASE_URL만 시딩에 사용할 수 있습니다.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

  if (LOCAL_SEED_HOSTS.has(hostname)) {
    if (databaseName !== LOCAL_DATABASE_NAME) {
      throw new Error("로컬 시딩은 pot 데이터베이스에서만 실행할 수 있습니다.");
    }

    return {
      kind: "local",
      databaseName: LOCAL_DATABASE_NAME,
      hostname,
    };
  }

  if (databaseName === LOCAL_DATABASE_NAME) {
    throw new Error("원격 pot 데이터베이스는 운영 DB일 수 있어 시딩할 수 없습니다.");
  }

  if (databaseName !== DEVELOPMENT_DATABASE_NAME) {
    throw new Error("원격 시딩은 pot_dev 데이터베이스에서만 실행할 수 있습니다.");
  }

  if (!hostname.endsWith(RDS_HOST_SUFFIX)) {
    throw new Error("AWS RDS PostgreSQL 호스트가 아닌 원격 DB에는 시딩할 수 없습니다.");
  }

  const expectedRdsHost = potDevRdsHost?.trim().toLowerCase();

  if (!expectedRdsHost || expectedRdsHost !== hostname) {
    throw new Error("접속 호스트가 POT_DEV_RDS_HOST와 일치하지 않습니다.");
  }

  if (potDevSeedConfirmation !== DEVELOPMENT_DATABASE_NAME) {
    throw new Error("개발 RDS 시딩에는 POT_DEV_SEED_CONFIRMATION=pot_dev가 필요합니다.");
  }

  return {
    kind: "development-rds",
    databaseName: DEVELOPMENT_DATABASE_NAME,
    hostname,
  };
}
