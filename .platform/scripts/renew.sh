#!/bin/bash
set -euo pipefail
source /opt/pot-https/duckdns.sh

load_duckdns_token
metadata_token=$(curl --fail --silent --show-error --max-time 5 -X PUT \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
    http://169.254.169.254/latest/api/token)
public_ip=$(curl --fail --silent --show-error --max-time 5 \
    -H "X-aws-ec2-metadata-token: $metadata_token" \
    http://169.254.169.254/latest/meta-data/public-ipv4)
[[ "$public_ip" =~ ^[0-9.]+$ ]] || { echo 'EC2 공인 IPv4를 읽지 못했습니다.' >&2; exit 1; }
duckdns_update --data-urlencode "ip=$public_ip"

certbot renew --non-interactive --quiet --deploy-hook 'systemctl reload nginx'
