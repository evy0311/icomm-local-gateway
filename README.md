# iCOMM Local Gateway

Local control and monitoring for an A. O. Smith iCOMM water heater, with a web
interface and Home Assistant MQTT discovery. The gateway replaces the heater's
device-service and UDP notification endpoints on your own network.

**Tested hardware:** EE9-50H55DV-A, iCOMM ResElec3, firmware 1.8. Other models are
not automatically supported. One gateway instance handles one heater.

Local commands, telemetry, authenticated UDP notifications, leak fault reporting,
and Home Assistant controls have been verified on that heater. A disposable,
Internet-isolated synthetic fixture also verifies startup with fresh local keys.
**First-time setup of a factory-fresh physical heater with all cloud access
blocked has not been verified.** Existing field trials include a previously
cloud-linked heater; a recovered session is not proof of cloud-free enrollment.

The original implementation and research are preserved on
[`initial-research`](https://github.com/evy0311/icomm-local-gateway/tree/initial-research).
`main` contains the Docker/MQTT gateway developed from that protocol work.

## What it provides

| Feature | Behavior |
| --- | --- |
| Target temperature | Reported setpoint and integer commands from 95–130°F |
| Modes | Standard and Vacation; no invented Off/power command |
| Vacation | Duration preference 1–99 days, plus independently reported remaining days |
| Command lifecycle | Queued → delivered → acknowledged → confirmed by matching heater telemetry |
| Cancel | Cancels only an undelivered command |
| Wake / poll | Authenticated UDP notification asks the heater to fetch commands; it does not force fresh measurements |
| Fault code | Last reported numeric code; 0 = none, 31 = water leak; other codes preserved |
| Leak alert | Code 31 asserts a moisture binary sensor; code 0 clears it; other faults do not clear an active leak |
| Hot-water estimate | Experimental 1–3 bar heuristic, explicitly provisional; **not** a confirmed manufacturer status |
| Availability | Keeps last values while authenticated UDP is alive; tracks report age separately |
| Diagnostics | Last report, command/error status, gateway mode, heater/UDP connection, read-only state |
| Web UI | Device details, local target control, wake action, traffic inspection, and bridge/capture settings |
| Diagnostic bridge | Explicitly opt-in forwarding to the real service, with local commands disabled |

MQTT discovery publishes **18 entities**. The setpoint is not an actual tank
water-temperature measurement. Energy consumption, heating-element activity,
valve control, and a verified LOW/MEDIUM/HIGH availability algorithm are not
implemented. [Hot-water estimate assumptions](docs/hot-water-status-research.md).

## Install: Home Assistant App or Docker

**Home Assistant OS/Supervisor:** add this repository under Settings → Apps →
Install app → Repositories, then install **iCOMM Local Gateway**. Configure the
MQTT options, keep read-only enabled initially, and open its authenticated Web UI.
[Full Home Assistant App instructions](icomm_gateway/DOCS.md).

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fevy0311%2Ficomm-local-gateway)

**Docker on Linux, OpenMediaVault, macOS or another server:** use the Compose
steps below and [Setup from scratch](docs/setup-from-scratch.md). No HACS,
Supervisor, or Home Assistant installation is needed to run the gateway; an MQTT
broker is required. HA integration is optional.

Both paths need a host/address with TCP80/443 and UDP55055 available. If another
HA App already owns those ports, use Docker on a separate host/address.
A small Linux VM with its own LAN IP is a straightforward option: the gateway
uses that VM's ports, and MQTT still connects it to Home Assistant. On Linux,
macvlan networking is an advanced alternative for giving a container a separate
LAN address; it is not part of the supplied Compose configuration. See
[port conflicts and deployment choices](docs/setup-from-scratch.md#port-conflicts-and-deployment-choices).

## Start here

1. Follow [Setup from scratch](docs/setup-from-scratch.md) for host preparation,
   MQTT, certificates, DNS, Wi-Fi setup, read-only checks, and enabling controls.
2. Use [MQTT and Home Assistant](docs/mqtt.md) for entities, command topics,
   availability, and notification examples.
3. For another heater, follow [Adding device support](docs/adding-device-support.md).
   Do not select the tested profile simply because a payload has the same length.
4. See [Troubleshooting](docs/troubleshooting.md) and [Architecture](docs/architecture.md).

### Minimal Docker deployment

Requires Docker with Compose v2, OpenSSL, and a reachable MQTT broker. Download
images/dependencies before attempting an Internet-isolated installation.

```sh
git clone https://github.com/evy0311/icomm-local-gateway.git
cd icomm-local-gateway
cp .env.example .env
chmod 600 .env
# Edit .env: reserve and set BIND_IP, MQTT_URL and dedicated MQTT credentials.
# Keep READ_ONLY=true and GATEWAY_MODE=local for the first checks.
sh scripts/generate-cert.sh
sh scripts/deploy.sh YOUR_DOCKER_HOST_LAN_IP -f compose.yml
```

Open **http://127.0.0.1:8789/** on that Docker host. The dashboard is loopback-only
and unauthenticated. On a remote server, use an SSH tunnel or an authenticated
proxy; do not publish the admin port directly to your LAN or the Internet.

The heater needs the host's **TCP 443, TCP 80, and UDP 55055**. DNS changes the
address, not the port. Reserve a separate host/LAN address if these ports conflict
with another service. Rewrite the exact device-service hostname observed from
that heater and `ans-field.aylanetworks.com` to the Docker host's LAN IPv4 address.
See the setup guide before reconnecting the heater.

After verifying compatible reports, set `READ_ONLY=false` and recreate the
stack. Alternatively `-f compose.yml -f compose.ha.yml` explicitly enables controls.
Never combine the HA deployment with `compose.test.yml`: the test override selects
its private broker and removes MQTT credentials.

## Local operation and its boundaries

In local mode the service does not forward heater requests to the vendor. It
answers supported startup/identity exchanges, supplies the observed reporting
subscription, serves command polls, and maintains authenticated UDP notifications.
Local enrollment generates its own keys; raw cloud captures are not distributed
or required as installation files.

DNS rewrites alone cannot prevent cached public addresses, alternate DNS, or IPv6
from bypassing the gateway. For a genuinely offline installation, block the
**heater's Internet egress** while allowing DHCP, your DNS server, and the gateway.
Local mode cannot enforce router/firewall policy. A laptop that sleeps is a poor
long-term host: it also stops answering heater keepalives.

Bridge mode deliberately uses the cloud and is only for diagnostics. Switching
modes does not automatically renegotiate a heater's existing identity or UDP key.
A session established with the other endpoint may need a Wi-Fi reconnect; do not
keep resetting a heater before checking host reachability and captured traffic.

This is experimental appliance software, not a safety controller. The physical
controls, built-in alarms, and manufacturer safety instructions remain authoritative.

## Data, privacy, and updates

Keep the `gateway-data` volume and `certs/` directory. The volume contains device
identity, settings, reported state, and private resumable-session material. Never
copy it between unrelated heaters or erase it to perform a software update.
Pending commands are marked interrupted on restart and are never automatically replayed.

`CAPTURE_MODE=redacted` is the default. Opt-in `full` captures preserve complete
HTTP headers/bodies and UDP bytes and can contain credentials. Keep all captures,
`.env`, keys, device identifiers, and backups private. The UI shows only the newest
100 events; journal rotation does not delete older files. Monitor disk use.
See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

For updates, back up the volume and certificates, pull `main`, and rerun the
same deployment command, from the same directory with the same Compose project
name. The included project name is `icomm-mqtt`; keeping it preserves volume identity.
An installation of `initial-research` uses a different implementation: back it up
and follow the new setup guide rather than assuming its state schema is compatible.
Do not run both implementations against the same heater at once.

## Development

```sh
npm ci
npm test
npm run check
docker compose config --quiet
```

[Development and disposable Docker tests](docs/development.md) cover the real
TLS/MQTT and Internet-isolated synthetic startup checks. Never inject fixture
traffic into an instance that has learned a real heater.

Standalone Docker Compose and the experimental Home Assistant App are supported
installation paths. HACS is not used. MQTT connects either to an existing broker;
an additional production broker is unnecessary.

MIT licensed. See [NOTICE](NOTICE) for protocol, UI-workflow, and icon attribution.
