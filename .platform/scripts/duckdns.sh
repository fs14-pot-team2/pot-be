#!/bin/bash
set -euo pipefail

DUCKDNS_DOMAIN=pot-api.duckdns.org
DUCKDNS_SUBDOMAIN=pot-api

load_duckdns_token() {
    if [[ -z "${DUCKDNS_TOKEN:-}" ]]; then
        DUCKDNS_TOKEN=$(/opt/elasticbeanstalk/bin/get-config environment -k DUCKDNS_TOKEN)
    fi
    [[ -n "$DUCKDNS_TOKEN" ]] || { echo 'DUCKDNS_TOKEN 환경 속성이 필요합니다.' >&2; exit 1; }
    export DUCKDNS_TOKEN
}

duckdns_update() {
    local response
    response=$(curl --fail --silent --show-error --max-time 15 --get \
        --data-urlencode "domains=$DUCKDNS_SUBDOMAIN" \
        --data-urlencode "token=$DUCKDNS_TOKEN" \
        "$@" https://www.duckdns.org/update)
    [[ "$response" == OK ]] || { echo 'DuckDNS 갱신에 실패했습니다.' >&2; exit 1; }
}
