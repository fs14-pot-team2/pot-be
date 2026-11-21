#!/usr/bin/env bash

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PACKAGE_ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL 환경 변수가 필요합니다." >&2
  exit 1
fi

case "${POT_MIGRATION_ENV:-dev}" in
  dev|prod) ;;
  *)
    echo "Invalid migration environment." >&2
    exit 1
    ;;
esac

if [[ "${POT_MIGRATION_ENV:-dev}" == "prod" ]]; then
  : "${POT_EXPECTED_DB_NAME:?Expected database name required}"
  : "${POT_EXPECTED_DB_HOST:?Expected database host required}"

  node --input-type=module -e '
    const url = new URL(process.env.DATABASE_URL);
    const dbName = decodeURIComponent(url.pathname.slice(1));

    const valid =
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      dbName === process.env.POT_EXPECTED_DB_NAME &&
      dbName !== "pot_dev" &&
      url.hostname === process.env.POT_EXPECTED_DB_HOST;

    if (!valid) {
      console.error("Production database target validation failed.");
      process.exit(1);
    }
  '
fi

exec node node_modules/prisma/build/index.js migrate deploy
