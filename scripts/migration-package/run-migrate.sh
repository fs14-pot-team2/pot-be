#!/usr/bin/env bash

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PACKAGE_ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL 환경 변수가 필요합니다." >&2
  exit 1
fi

exec node node_modules/prisma/build/index.js migrate deploy
