import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertAllowedSeedTarget } from "../src/config/seed-target.js";

const RDS_HOST = "pot-dev.abc123.ap-northeast-2.rds.amazonaws.com";

describe("assertAllowedSeedTarget", () => {
  it("localhost의 pot 데이터베이스를 허용한다", () => {
    const target = assertAllowedSeedTarget({
      databaseUrl: "postgresql://postgres:password@localhost:5432/pot?schema=public",
      potDevRdsHost: undefined,
      potDevSeedConfirmation: undefined,
    });

    assert.deepEqual(target, {
      kind: "local",
      databaseName: "pot",
      hostname: "localhost",
    });
  });

  it("127.0.0.1의 pot 데이터베이스를 허용한다", () => {
    const target = assertAllowedSeedTarget({
      databaseUrl: "postgresql://postgres:password@127.0.0.1:5432/pot",
      potDevRdsHost: undefined,
      potDevSeedConfirmation: undefined,
    });

    assert.equal(target.kind, "local");
  });

  it("로컬의 pot_dev 데이터베이스를 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: "postgresql://postgres:password@localhost:5432/pot_dev",
          potDevRdsHost: undefined,
          potDevSeedConfirmation: undefined,
        }),
      /로컬 시딩은 pot 데이터베이스/,
    );
  });

  it("명시적으로 승인한 개발 RDS의 pot_dev 데이터베이스를 허용한다", () => {
    const target = assertAllowedSeedTarget({
      databaseUrl: `postgresql://postgres:password@${RDS_HOST}:5432/pot_dev?schema=public`,
      potDevRdsHost: RDS_HOST,
      potDevSeedConfirmation: "pot_dev",
    });

    assert.deepEqual(target, {
      kind: "development-rds",
      databaseName: "pot_dev",
      hostname: RDS_HOST,
    });
  });

  it("원격 운영 pot 데이터베이스를 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: `postgresql://postgres:password@${RDS_HOST}:5432/pot`,
          potDevRdsHost: RDS_HOST,
          potDevSeedConfirmation: "pot_dev",
        }),
      /원격 pot 데이터베이스/,
    );
  });

  it("pot_dev가 아닌 원격 데이터베이스를 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: `postgresql://postgres:password@${RDS_HOST}:5432/other_dev`,
          potDevRdsHost: RDS_HOST,
          potDevSeedConfirmation: "pot_dev",
        }),
      /pot_dev 데이터베이스/,
    );
  });

  it("AWS RDS가 아닌 원격 pot_dev 데이터베이스를 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: "postgresql://postgres:password@db.example.com:5432/pot_dev",
          potDevRdsHost: "db.example.com",
          potDevSeedConfirmation: "pot_dev",
        }),
      /AWS RDS PostgreSQL 호스트/,
    );
  });

  it("예상 RDS 호스트와 다른 pot_dev 데이터베이스를 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: `postgresql://postgres:password@${RDS_HOST}:5432/pot_dev`,
          potDevRdsHost: "other.abc123.ap-northeast-2.rds.amazonaws.com",
          potDevSeedConfirmation: "pot_dev",
        }),
      /POT_DEV_RDS_HOST/,
    );
  });

  it("명시적 승인 값이 없는 개발 RDS를 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: `postgresql://postgres:password@${RDS_HOST}:5432/pot_dev`,
          potDevRdsHost: RDS_HOST,
          potDevSeedConfirmation: undefined,
        }),
      /POT_DEV_SEED_CONFIRMATION=pot_dev/,
    );
  });

  it("DATABASE_URL이 없거나 PostgreSQL URL이 아니면 차단한다", () => {
    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: undefined,
          potDevRdsHost: undefined,
          potDevSeedConfirmation: undefined,
        }),
      /DATABASE_URL이 설정되지 않았습니다/,
    );

    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: "mysql://root:password@localhost:3306/pot",
          potDevRdsHost: undefined,
          potDevSeedConfirmation: undefined,
        }),
      /PostgreSQL DATABASE_URL/,
    );
  });

  it("오류 메시지에 DATABASE_URL의 인증 정보를 노출하지 않는다", () => {
    const secret = "do-not-log-this-password";

    assert.throws(
      () =>
        assertAllowedSeedTarget({
          databaseUrl: `postgresql://production:${secret}@prod.example.com:5432/pot`,
          potDevRdsHost: undefined,
          potDevSeedConfirmation: undefined,
        }),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
  });
});
