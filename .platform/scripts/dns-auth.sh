#!/bin/bash
set -euo pipefail
source /opt/pot-https/duckdns.sh

[[ "${CERTBOT_IDENTIFIER:-${CERTBOT_DOMAIN:-}}" == "$DUCKDNS_DOMAIN" ]] || exit 1
[[ -n "${CERTBOT_VALIDATION:-}" ]] || exit 1
load_duckdns_token
duckdns_update --data-urlencode "txt=$CERTBOT_VALIDATION"

for attempt in {1..30}; do
    if dig +short TXT "_acme-challenge.$DUCKDNS_DOMAIN" @1.1.1.1 | tr -d '"' | grep -Fxq "$CERTBOT_VALIDATION"; then
        exit 0
    fi
    sleep 10
done
echo 'DuckDNS TXT 레코드 전파를 확인하지 못했습니다.' >&2
exit 1
