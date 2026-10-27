#!/bin/bash
set -euo pipefail
source /opt/pot-https/duckdns.sh

load_duckdns_token
if [[ -z "${ACME_EMAIL:-}" ]]; then
    ACME_EMAIL=$(/opt/elasticbeanstalk/bin/get-config environment -k ACME_EMAIL)
fi
[[ "$ACME_EMAIL" == *@* ]] || { echo 'ACME_EMAIL 환경 속성이 필요합니다.' >&2; exit 1; }

if ! command -v certbot >/dev/null || ! command -v dig >/dev/null; then
    dnf install -y certbot bind-utils
fi

/opt/pot-https/renew.sh
certbot certonly --manual --preferred-challenges dns \
    --manual-auth-hook /opt/pot-https/dns-auth.sh \
    --manual-cleanup-hook /opt/pot-https/dns-cleanup.sh \
    --non-interactive --agree-tos --email "$ACME_EMAIL" \
    --cert-name "$DUCKDNS_DOMAIN" -d "$DUCKDNS_DOMAIN" \
    --keep-until-expiring

cat > /etc/systemd/system/pot-https-renew.service <<'EOF'
[Unit]
Description=Update POT DuckDNS and renew HTTPS certificate

[Service]
Type=oneshot
ExecStart=/opt/pot-https/renew.sh
EOF

cat > /etc/systemd/system/pot-https-renew.timer <<'EOF'
[Unit]
Description=Check POT HTTPS certificate twice daily

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now pot-https-renew.timer
