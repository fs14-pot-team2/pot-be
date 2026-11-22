#!/bin/bash
set -euo pipefail

certbot renew --non-interactive --quiet \
    --deploy-hook 'systemctl reload nginx'
