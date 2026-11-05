#!/bin/sh
# Disposable only: this script owns the project/volumes it creates and cleans up.
set -eu
cd "$(dirname "$0")/.."
project="icomm-verify-$$"
export BIND_IP=127.0.0.1 STATUS_PORT=18789 HTTPS_PORT=18443 HTTP_PORT=18080 ANS_PORT=15555 TEST_MQTT_PORT=18885
compose() { docker compose -p "$project" -f compose.yml -f compose.test.yml "$@"; }
cleanup() { compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
if [ ! -f certs/device.crt ] || [ ! -f certs/device.key ]; then sh scripts/generate-cert.sh; fi
compose up -d --build --wait
node test/smoke.mjs
compose down -v
# New empty data volume for startup; never reuse the first fixture's learned ID.
docker compose -p "$project" -f compose.yml -f compose.test.yml -f compose.control-test.yml -f compose.offline-test.yml up -d --wait
# Docker Desktop does not always publish ports from internal networks to the host.
# Run this fixture inside the isolated gateway namespace instead.
compose cp test gateway:/app/test
compose exec -T -e STATUS_PORT=8081 -e HTTPS_PORT=443 -e TEST_TLS_HOST=tls \
  -e ANS_PORT=55055 -e TEST_ANS_HOST=127.0.0.1 -e TEST_COMMANDS_ENABLED=1 \
  gateway node test/offline-startup-smoke.mjs
