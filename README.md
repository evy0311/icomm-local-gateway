# iCOMM Local Gateway

An experimental, local-first gateway for compatible A. O. Smith iCOMM water heaters. It receives and decodes heater telemetry, provides a browser dashboard, and delivers setpoint and Standard/Vacation commands without forwarding the heater's traffic to Ayla or the public Internet.

> **Early research release:** this is not an A. O. Smith product, not a Home Assistant integration yet, and not ready for unattended production use. It has been verified on one heater/firmware combination. Read the safety and compatibility notes before testing.

## What works today

- Fully local telemetry for setpoint, Standard/Vacation mode, and vacation duration.
- Local setpoint control from 95–130°F (35–54.4°C), constrained to the observed appliance range.
- Local Standard and 1–99 day Vacation mode control.
- Command acknowledgement and confirmation from subsequent heater telemetry.
- Automatic discovery of the Ayla numeric device ID from the heater's first request.
- Local DNS interception, TLS termination, an ANS UDP sink, persistent state, and a small web dashboard.
- No cloud credentials and no outbound Ayla relay in the published gateway.
- A redacted diagnostics generator and structured GitHub issue templates for testing other heaters.

The verified heater uses a roughly five-minute fallback command poll when isolated from Ayla. A queued command may therefore wait 5–6 minutes before the heater retrieves it. Once retrieved, acknowledgement and confirming telemetry normally arrive within about a second. Reproducing the authenticated UDP wake-up for instant delivery remains open research.

Hot-water level and energy use are not decoded yet. They stay explicitly labeled as unknown rather than presenting guessed values.

## Verified hardware

| Manufacturer | Model | Module family | Firmware | Result |
|---|---|---|---|---|
| A. O. Smith | EE9-50H55DV-A | iCOMM ResElec3 | 1.8 | Telemetry, setpoint, Standard, and Vacation verified |

Other iCOMM models may use different telemetry layouts or command frames. The gateway refuses commands until it has decoded a compatible telemetry report. See [testing a new heater](docs/testing-new-heaters.md) and [supported devices](docs/supported-devices.md).

## How it works

The heater is placed on a network whose gateway you control. Narrow firewall rules redirect only that heater's DNS, HTTPS, and legacy Ayla Notification Service traffic to this project. Apache provides the older TLS behavior accepted by the tested Wi-Fi module. The Node service then:

1. acknowledges the heater's device-service requests locally;
2. decodes `superBlockDyn1` telemetry;
3. queues a command selected in the dashboard;
4. returns that command on the heater's next `/commands.xml` request; and
5. confirms the result from the acknowledgement and subsequent telemetry.

The local-only firewall rule drops every other IPv4 packet from the heater. See [architecture](docs/architecture.md) for ports, trust boundaries, and limitations.

## Safety and privacy

- Water above 120°F (49°C) can scald. Follow the appliance manual and local requirements. The project's 130°F maximum is a protocol observation, not a safety recommendation.
- Test only equipment and networks you own or are authorized to administer.
- Keep the heater's physical controls accessible. Do not rely on this project for freeze protection, sanitation cycles, fault response, or any safety function.
- The official app will show the heater as offline while it is fully isolated.
- Do not publish your DSN, MAC address, Ayla device ID, account credentials, certificate private key, or unredacted packet captures.
- The dashboard binds to `127.0.0.1` by default. Do not expose it to an untrusted network; it has no authentication.
- The TLS front end intentionally uses an older compatibility image accepted by the tested legacy module. Keep port 8443 restricted to the isolated heater network and never publish it to the Internet.

## Quick start: macOS proof of concept

This is the currently verified path. It uses macOS Internet Sharing, Docker Desktop, and a narrowly scoped PF anchor. A router/VLAN deployment should implement the same traffic flow, but exact router instructions are not yet included.

### Prerequisites

- macOS with an Ethernet Internet connection and Wi-Fi available for Internet Sharing
- Docker Desktop with Compose
- Node.js 20 or newer (only for configuration, tests, and diagnostics)
- OpenSSL
- the heater's IPv4 address on the shared network

Aggressive LAN scanners can overwhelm some consumer networks. Prefer the router/DHCP client list or compare `arp -a` before and after enabling the heater's Wi-Fi. The tested Murata radio appeared as the heater after its Wi-Fi was toggled.

### 1. Clone and prepare

```sh
git clone https://github.com/evy0311/icomm-local-gateway.git
cd icomm-local-gateway
./scripts/generate-cert.sh
node scripts/configure.mjs
```

The configurator asks for:

- the heater IPv4 address;
- the Mac's address on the heater network (often `192.168.2.1` with Internet Sharing); and
- the Internet Sharing interface (often `bridge100`).

It creates two ignored files: `.env` and `pf-local-only.generated.conf`. Review both before continuing. It does not need your A. O. Smith email or password.

### 2. Start the gateway

```sh
docker compose up -d --build
docker compose ps
```

Apache may warn that the certificate is a CA certificate or does not match its server name. Those warnings are expected for the deliberately old-style certificate used by the tested module.

### 3. Load the heater-only redirects

```sh
sudo pfctl -a com.apple/icomm-local-gateway -f ./pf-local-only.generated.conf
sudo pfctl -k HEATER_IP
```

Replace `HEATER_IP` with the exact address entered into the configurator. `pfctl` may display a standard warning about loading rules; the rules are placed in a dedicated anchor and target only that one source address.

If the heater does not reconnect, toggle its Wi-Fi off and on using its control panel. Avoid interrupting power while the heater is actively heating unless the appliance manual says it is safe.

### 4. Verify telemetry and isolation

Follow the service log:

```sh
docker compose logs -f
```

A compatible heater should eventually produce lines similar to:

```text
telemetry setpoint=120F mode=STANDARD
local POST /devices/<device>/properties/superBlockDyn1/datapoints.xml -> 200
```

Open [http://localhost:8788](http://localhost:8788). Before sending a command, verify that the displayed setpoint and mode match the physical heater.

Confirm that no traffic from the heater reaches a public address:

```sh
sudo tcpdump -i bridge100 -n 'host HEATER_IP'
```

You should see local redirected traffic, DHCP, and retries—not a completed conversation with an Internet host.

### 5. Try one conservative command

Choose a setpoint one degree away from the current value. The dashboard will show `queued`, then `delivered`/`acknowledged`, and finally `confirmed`. Allow 5–6 minutes for the fallback poll. Verify the result on the physical control panel.

If you need to abandon a queued command, use **Cancel pending command** before the heater retrieves it.

### Stop and restore normal networking

```sh
sudo pfctl -a com.apple/icomm-local-gateway -F all
docker compose down
```

Then reconnect the heater to its normal Wi-Fi if desired. Removing the PF anchor is essential before expecting the official cloud app to work again.

For a detailed walkthrough, see [macOS setup](docs/macos-setup.md). For failures, see [troubleshooting](docs/troubleshooting.md).

## Local API

The dashboard uses a small unauthenticated loopback API:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Container health check |
| `GET` | `/api/state` | Current decoded state and command status |
| `POST` | `/api/desired-setpoint` | Queue `{ "fahrenheit": 120 }` |
| `POST` | `/api/desired-mode` | Queue `{ "mode": "STANDARD" }` or `{ "mode": "VACATION", "days": 7 }` |
| `POST` | `/api/cancel-command` | Cancel a command that has not been retrieved |

Example:

```sh
curl -sS -H 'content-type: application/json' \
  --data '{"fahrenheit":120}' \
  http://127.0.0.1:8788/api/desired-setpoint
```

Do not expose port 8788 beyond localhost without adding authentication and transport security.

## Testing another heater

Please help map compatibility, but begin read-only:

1. Follow the setup through telemetry reception.
2. Confirm the dashboard exactly matches the physical setpoint and mode.
3. Generate a sanitized diagnostic bundle with `node scripts/collect-diagnostics.mjs`.
4. Review the file manually.
5. Open a **Device compatibility report** using the GitHub issue template.

Never attach `.env`, anything under `certs/`, or an unredacted `.pcap`. Detailed steps and a safe test matrix are in [testing a new heater](docs/testing-new-heaters.md).

## Development

There are no runtime npm dependencies. Run the checks with:

```sh
npm test
npm run check
docker compose config
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request. Protocol observations and known command frames are documented in [docs/protocol.md](docs/protocol.md).

## Project direction

The first milestone is a reliable, auditable local gateway. Planned work includes broader device compatibility, labeled hot-water/energy fields, faster authenticated local notification, a router-friendly deployment, authentication, and eventually a HACS/Home Assistant integration. See the [roadmap](docs/roadmap.md).

## License and trademarks

MIT licensed. A. O. Smith, iCOMM, Ayla, and related marks belong to their respective owners. This independent project is not affiliated with or endorsed by A. O. Smith or Ayla Networks.
