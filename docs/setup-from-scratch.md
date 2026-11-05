# Setup from scratch

This guide targets the tested **EE9-50H55DV-A / ResElec3, firmware 1.8**. For a
different model, start with [Adding device support](adding-device-support.md).
Do not send guessed commands to an unknown appliance.

For Home Assistant OS/Supervisor, install/configure the [App](../icomm_gateway/DOCS.md)
instead of the Compose-specific steps1–2, then continue with DNS and heater setup
below. For App deployments the destination is the HA host LAN IP.

## 1. Prepare an always-on host and MQTT

Use a host with Docker Compose v2, OpenSSL, a reserved LAN IPv4 address, and
reliable uptime. Docker Desktop works for testing, but sleeping a laptop removes
the HTTPS/UDP services the heater needs. OpenMediaVault with Docker is suitable
if the required ports are free on its chosen LAN address.

Reserve the heater's DHCP address as well. Allow the heater to reach the Docker
host on TCP **443**, TCP **80**, and UDP **55055**. Do not port-forward these
services from the Internet. TCP 443 is a legacy TLS compatibility endpoint, not
the admin UI. A host-port remap does not tell the heater to use a different port.
If the host already uses 80/443, use a separate host/address or deliberately
reconfigure the conflicting service first; never stop another service blindly.

In Home Assistant, configure the MQTT integration and an MQTT broker (the
Mosquitto App is one option). Create a dedicated broker login. Do not use a
public or anonymous LAN broker. The gateway needs to publish its discovery and
`icomm/<instance>/#` topics and subscribe to its command topics and HA's birth topic.

## 2. Download and configure

```sh
git clone https://github.com/evy0311/icomm-local-gateway.git
cd icomm-local-gateway
cp .env.example .env
chmod 600 .env
```

Edit `.env` locally:

| Setting | Value |
| --- | --- |
| `BIND_IP` | Docker host's reserved LAN IPv4 address, not a container IP |
| `MQTT_URL` | `mqtt://YOUR_BROKER_HOST:1883`, or a trusted `mqtts://` endpoint |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | Dedicated broker credentials |
| `DEVICE_PROFILE` | `reselec3` for the verified model only |
| `DEVICE_NAME` | Friendly name for the MQTT device |
| `READ_ONLY` | `true` initially |
| `GATEWAY_MODE` | `local` |
| `CAPTURE_MODE` | `redacted`; `full` only for private research |

Leave `DEVICE_ID` empty to learn the first numeric device ID. One instance accepts
one heater; subsequent different device IDs are rejected. Keep credentials out
of shell history and Git. MQTT TLS validates certificates normally.

```sh
sh scripts/generate-cert.sh
sh scripts/deploy.sh YOUR_DOCKER_HOST_LAN_IP -f compose.yml
```

The certificate script refuses to overwrite existing files. Preserve `certs/`.
The deployment helper checks **published LAN TCP 443**, not just container health;
on a Docker Desktop port-forwarding failure it recreates only the TLS frontend.
Its `/ping` check intentionally accepts the self-signed heater endpoint and sends
no credentials or appliance commands.

Open `http://127.0.0.1:8789/` on the host. For a remote server:

```sh
ssh -N -L 8789:127.0.0.1:8789 YOUR_SERVER_LOGIN@YOUR_DOCKER_HOST
```

Then open that same loopback URL on your computer. This admin UI has no login;
keep its default loopback binding. In Settings, deployment defaults apply unless
saved UI overrides exist. UI mode/cloud-host/capture settings take precedence
over `.env`; **Use deployment defaults** removes those overrides.

## 3. Configure DNS before Wi-Fi setup

Use your local DNS server's query log, filtered to the heater's reserved IP, to
identify its **exact device-service hostname**. The tested family uses a name
ending in `-device.aylanetworks.com`; the product prefix is not universal. If you
have no existing query record, discover it on an isolated observation network
with public connectivity blocked. A completely unknown model needs research first.
Do not copy another owner's device identity or private enrollment state.

In AdGuard Home: **Filters → DNS rewrites → Add DNS rewrite**:

| Domain | Answer |
| --- | --- |
| Exact device-service hostname observed from this heater | Docker host LAN IPv4 address |
| `ans-field.aylanetworks.com` | Same Docker host LAN IPv4 address |

Use an IP address only, with no `https://`, path, or port. Do not use `127.0.0.1`
or the Docker-internal address, and do not wildcard the entire vendor domain.

Configure the heater's network DHCP/DNS to use AdGuard. On Deco, the exact menu
varies by model/firmware and router/AP mode; verify the DNS actually advertised
to clients. Avoid a public secondary resolver that can bypass rewrites. Check
IPv6 DNS/routing too. Refresh the client's DHCP lease or Wi-Fi connection after
DNS changes if it continues using cached settings.

```sh
dig @YOUR_ADGUARD_IP YOUR_EXACT_DEVICE_SERVICE_HOSTNAME A
dig @YOUR_ADGUARD_IP ans-field.aylanetworks.com A
```

Both should answer with the gateway host. Also confirm **queries from the heater**
show as rewritten: a successful query from your laptop is not proof of its DNS.
For offline operation, block heater Internet egress at the router/firewall while
allowing local DHCP, DNS, and gateway traffic. DNS rewriting is not an egress block.

## 4. Join Wi-Fi using the heater's own portal

No pairing app is implemented or required for the observed captive-portal flow.
Use the manual revision matching your heater. The January 2022 electronic
thermostat manual (printed page 18) describes holding Wi-Fi for three seconds to
remove the saved network, then pressing Wi-Fi to start pairing. The older October
2021 revision instead specifies **Wi-Fi + Up** for three seconds.

- [January 2022 manual](https://www.aosmithatlowes.com/media/1715/smart-electric-2000598248.pdf)
- [October 2021 manual](https://s3.amazonaws.com/assets.aosmith.com/damroot/Original/10008/100341153.pdf)

On the tested panel, a three-second hold beeped, briefly extinguished the light,
and it returned solid; this alone did not prove memory was erased. A brief Wi-Fi
press subsequently exposed the temporary setup network. Do not substitute reset
sequences from unrelated heat-pump/heater families.

1. Verify the gateway's LAN HTTPS check succeeds **before** changing the heater.
2. Start pairing with the matching panel procedure. The documented pairing
   indicator blinks about every half-second; its setup window is 15 minutes.
3. On a phone, join the temporary `iCOMM` network matching the heater's identity.
4. Open its captive setup page. If it does not open automatically, identify the
   local gateway address in that Wi-Fi network's details. A universal portal URL
   has not been established for all revisions.
5. Select your home/IoT Wi-Fi, enter its password, and submit.
6. Let the portal complete; it may close when the temporary network disappears.
   Return your phone to the home network.
7. Verify traffic and reports in the gateway. A solid light, portal closing, or
   a `cloud_connecting` label alone is not proof of working local control.

These are Wi-Fi setup/reset instructions, **not** a documented cloud-account or
factory reset. They do not prove deletion of persistent cloud credentials.

## 5. Verify read-only operation

The Devices page should learn the heater and show a compatible setpoint/mode
report with an actual receive time. Traffic should show startup/property exchanges
and authenticated local UDP registration or a resumed session. Zero capture errors
and continued keepalives are useful checks. An old saved value is not a new report.

MQTT discovery creates the device in HA when the broker connects. Data remains
unavailable until compatible telemetry is known and the heater connection is
alive. Fault/leak entities need their own fault report; they start unknown rather
than assuming no fault. In read-only mode, command controls remain unavailable.

If setup stalls, check [Troubleshooting](troubleshooting.md) first. Do not keep
reprovisioning the heater to diagnose a broken host port or an expired session.

## 6. Enable and verify local commands

After confirming the exact supported model and read-only reports, set
`READ_ONLY=false` in `.env` and run:

```sh
sh scripts/deploy.sh YOUR_DOCKER_HOST_LAN_IP -f compose.yml
```

The optional `-f compose.yml -f compose.ha.yml` override also explicitly enables
writes. Do not include the private test-broker override in production.

Choose a small, safe setpoint change within 95–130°F using the UI or HA, confirm
it on the physical heater and in a new report, then restore the intended setting.
Do not repeatedly send commands while one is pending. An acknowledgment means
receipt, not application; only matching subsequent telemetry confirms a command.

UDP notification normally prompts a command fetch. The approximately five-minute
HTTPS fallback can still delay delivery. Wake / poll only requests a command fetch;
it does not promise a fresh temperature reading. Undelivered commands expire after
15 minutes; delivered-but-unconfirmed does not prove failure. Check the appliance
before retrying. Restarted commands are interrupted, never automatically replayed.

Test Vacation only when appropriate for the household. Duration in Standard is a
saved preference; selecting Vacation sends it. Remaining days comes from reports.

## 7. Monitoring, faults, and notifications

The heater sends reports on changes. Quiet temperature reports do not disconnect
entities while authenticated UDP remains active. HA keeps last values, and the
original report time stays visible. Missing authenticated UDP eventually expires
the session (normally around 90 seconds); actual connection loss or broker/gateway
loss makes entities unavailable. No keepalive invents a new measurement.

`faultCode=31` asserts Water leak detected, and `faultCode=0` clears it. These
are separate reports from temperature. A zero does not prove the physical sensor
is connected or functional. Do not submerge hardware just to test software; follow
the sensor's manufacturer procedure. [MQTT/HA guide](mqtt.md) includes an optional
critical notification automation. No household-specific automation is installed
by this repository.

The hot-water bars are explicitly a provisional estimate. Lower levels/thresholds
remain unverified; do not use the estimate for appliance control or safety decisions.

## 8. Preserve data, update, and roll back

Back up `certs/`, your private `.env`, and the `gateway-data` volume securely.
Stop the gateway briefly for a consistent volume snapshot if your backup tool
cannot snapshot atomically. Preserve file permissions and keep backups private.
Do not use `docker compose down -v` on the working stack.

Use the same checkout, Compose project name, environment, and volume for updates:
`git pull --ff-only`, then your original deployment command. Record the previous
commit/image before updating. Roll back with that version and a matching private
backup if a future schema migration requires it; do not delete working identity
state. Versioned release/migration tooling is not implemented yet.

Optional private diagnostic export (creates a new file, never overwrites):

```sh
sh scripts/export-capture.sh /YOUR_PRIVATE_DIRECTORY/capture.tar.gz -f compose.yml
```

Full captures contain credentials. Never publish the export in an issue or PR.

## 9. What still needs an offline acceptance test

Working local control is verified, but the complete new-owner path is not yet
proven on physical hardware. The remaining test needs empty gateway storage,
a Wi-Fi-reset/factory-fresh heater with no imported account/session material,
and independently blocked Internet egress for both heater and gateway. Verify
startup, fresh reports, physical commands, reconnects, and power recovery.

Use a separate instance/volume for that test; do not destroy the working owner's
state. The disposable [offline fixture](development.md) covers fresh local keys
and protocol exchanges with container egress disabled, not the physical radio's
persistent identity or every firmware's provisioning behavior.


## Port conflicts and deployment choices

The same port can be used on different machines/IP endpoints. For example, the
HA host can keep its existing services while a separate Linux VM serves the
heater at that VM's own reserved LAN address. Install Docker/Compose inside the
VM and use this guide unchanged; the gateway still publishes to HA's existing
MQTT broker. DNS rewrites point to the VM, not the HA host. This is the simplest
way to avoid sharing the heater's fixed ports with an existing HA App.

A separate always-on Linux Docker machine is equivalent, provided its chosen
address has ports80/443 and UDP55055 free. OpenMediaVault's web interface often
already uses80, so moving the stack to OMV's existing IP does not automatically
resolve the conflict.

An advanced option on a Linux Docker host is macvlan (or an appropriately designed
ipvlan network): containers can have independent LAN addresses. The supplied
Compose stack uses two services; any custom network design must account for
both the TLS frontend and HTTP/UDP gateway, their private inter-service route,
and admin access. Merely setting BIND_IP to an unused address does not assign
that address to a host or create macvlan networking. Docker Desktop on Mac/Windows
does not support macvlan. Macvlan also blocks container-to-host communication by
default, requiring an additional path if the broker/admin endpoint is on that host.
See [Docker's macvlan documentation](https://docs.docker.com/engine/network/drivers/macvlan/).

Changing the HA App's published443 port to8443 alone cannot work: ordinary DNS
rewrites convey an IP, not a port, and the heater still connects to443. A
client-specific router NAT rule could translate the destination port if the router
supports that, but it is not part of this setup and is less portable. Do not assume
a Deco router supports such LAN-to-LAN rules without verifying the exact model.
