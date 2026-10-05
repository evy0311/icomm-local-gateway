#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cert_dir="$project_dir/certs"

mkdir -p "$cert_dir"
if [ -e "$cert_dir/device.key" ] || [ -e "$cert_dir/device.crt" ]; then
  echo "A gateway certificate already exists in $cert_dir."
  echo "Move it aside first if you intentionally want to replace it."
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
  -config "$project_dir/scripts/openssl.cnf" \
  -extensions v3_ca \
  -keyout "$cert_dir/device.key" \
  -out "$cert_dir/device.crt"

chmod 600 "$cert_dir/device.key"
echo "Created $cert_dir/device.crt and device.key"
echo "The private key is ignored by Git. Never upload or share it."
