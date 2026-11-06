#!/bin/bash
set -euo pipefail

readonly RDS_CA_URL="https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem"
readonly RDS_CA_DIRECTORY="/etc/pot"
readonly RDS_CA_PATH="${RDS_CA_DIRECTORY}/rds-ca.pem"

temporary_file="$(mktemp)"
trap 'rm -f "${temporary_file}"' EXIT

echo "AWS RDS 서울 리전 CA 인증서 번들을 다운로드합니다."
curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --retry 3 \
  --retry-all-errors \
  --proto '=https' \
  --tlsv1.2 \
  --output "${temporary_file}" \
  "${RDS_CA_URL}"

if [[ ! -s "${temporary_file}" ]]; then
  echo "다운로드한 AWS RDS CA 인증서 파일이 비어 있습니다." >&2
  exit 1
fi

if ! grep -q -- "-----BEGIN CERTIFICATE-----" "${temporary_file}"; then
  echo "다운로드한 파일이 PEM 인증서 번들이 아닙니다." >&2
  exit 1
fi

if ! openssl crl2pkcs7 \
  -nocrl \
  -certfile "${temporary_file}" \
  -outform DER \
  -out /dev/null; then
  echo "다운로드한 AWS RDS CA 인증서 번들을 검증할 수 없습니다." >&2
  exit 1
fi

install -d -o root -g root -m 0755 "${RDS_CA_DIRECTORY}"
install -o root -g root -m 0644 "${temporary_file}" "${RDS_CA_PATH}"

echo "AWS RDS CA 인증서 번들을 ${RDS_CA_PATH}에 설치했습니다."
