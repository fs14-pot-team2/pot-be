#!/bin/bash
set -euo pipefail
source /opt/pot-https/duckdns.sh

[[ "${CERTBOT_IDENTIFIER:-${CERTBOT_DOMAIN:-}}" == "$DUCKDNS_DOMAIN" ]] || exit 1
load_duckdns_token
duckdns_update --data-urlencode 'txt=' --data-urlencode 'clear=true'
