#!/bin/sh
# Check the actual published heater port, not just container-internal health.
set -eu
if [ "$#" -lt 1 ]; then
  echo 'Usage: sh scripts/deploy.sh LAN-IP [docker compose options]' >&2
  exit 1
fi
lan_ip=$1
shift
case "$lan_ip" in ''|*[!0-9.]*) echo 'Use the Docker host IPv4 address.' >&2; exit 1;; esac
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
check_lan() {
  if command -v curl >/dev/null 2>&1; then
    curl --noproxy '*' --insecure --fail --silent --show-error --retry 2 \
      --retry-all-errors --retry-delay 1 --max-time 5 "https://$lan_ip/ping" >/dev/null
    result=$?
    if [ "$result" -eq 0 ]; then echo 'Published LAN HTTPS endpoint responds successfully.'; fi
    return "$result"
  fi
  docker compose "$@" exec -T gateway node - "$lan_ip" <<'NODE'
const https = require('node:https');
const net = require('node:net');
const ip = process.argv[2];
const octets = ip.split('.').map(Number);
if (!net.isIPv4(ip) || !(octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31))) {
  console.error('Expected a private LAN or loopback IPv4 address'); process.exit(1);
}
// The heater compatibility endpoint intentionally uses its local self-signed
// certificate. This check sends no identity, credentials or appliance commands.
let attempts = 0;
function attempt() {
attempts++;
const request = https.get({ hostname: ip, port: 443, path: '/ping',
  rejectUnauthorized: false, timeout: 5000 }, response => {
  response.resume();
  response.on('end', () => {
    if (response.statusCode !== 200) { console.error('LAN HTTPS status', response.statusCode); process.exitCode = 1; }
    else console.log('Published LAN HTTPS endpoint responds successfully.');
  });
});
request.on('timeout', () => request.destroy(new Error('LAN HTTPS timed out')));
request.on('error', error => {
  if (attempts < 3) { setTimeout(attempt, 500); return; }
  console.error('Published LAN HTTPS failed:', error.code ?? error.message); process.exitCode = 1;
});
}
attempt();
NODE
}
docker compose "$@" up -d --build gateway tls
if ! check_lan "$@"; then
  echo 'Recreating the TLS frontend to repair its published port.' >&2
  docker compose "$@" up -d --force-recreate --no-deps tls
  check_lan "$@"
fi
