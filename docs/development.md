# Development and disposable tests

Requires Node.js22+, npm, Docker Compose v2, OpenSSL and curl. Install dependencies:

```sh
npm ci
npm test
npm run check
node scripts/sync-ha-app.mjs --check
docker compose config --quiet
```

`src/` is canonical source. Supervisor builds one App folder at a time, so
`icomm_gateway/generated/` is a committed allowlisted copy of runtime source and
package/config files. Regenerate it with `node scripts/sync-ha-app.mjs` after a
source change. CI rejects drift. Never edit generated files or copy runtime data.
App-only option mapping/supervision lives in `icomm_gateway/` outside that copy.

## Disposable Docker checks

```sh
sh scripts/test-docker.sh
```

The script uses its own project name, separate data volume, loopback-only alternate
ports, synthetic identities and private test broker. It cleans up **only that new
test project and volume**. Never use the script's fixtures against a real instance.
The included test clients refuse an instance that already has telemetry/device data.

It runs real legacy TLS → HTTP → MQTT discovery/read-only checks, then starts a
fresh internal-network fixture for locally generated identity, signed UDP registration,
keepalive, notification, command fetch, empty receipt and matching report. Docker's
internal network blocks container Internet access; the startup fixture runs
inside that isolated gateway namespace, while the ordinary MQTT fixture uses
loopback host ports. This is not a physical appliance's offline-enrollment certification.
Images/dependencies must be downloaded before testing runtime egress isolation.

The App image can be built independently:

```sh
docker build -t icomm-ha-app-test ./icomm_gateway
```

Unit/HTTP tests cover App option mapping, ingress peer restrictions, CSRF behavior
and relative asset/API URLs. Test both supported image architectures before adding
an architecture to the App manifest. A successful image build is distinct from
an installation on a physical HA Supervisor host.

No test publishes synthetic leak values into the production HA broker. Real fault
fixtures are reduced to public code31/0 and synthetic device IDs, not full captured
owner traffic. Development captures belong outside Git and build contexts.
