# Install in Home Assistant

Requires Home Assistant OS/Supervisor with Apps, a supported 64-bit amd64/aarch64
host, a configured MQTT broker/integration, and free heater-facing host ports.
Home Assistant Container/Core users should use standalone Docker Compose instead.

## Add the repository and install

1. Open **Settings → Apps → Install app** (App store on some versions).
2. Open the top-right menu → **Repositories**.
3. Add `https://github.com/evy0311/icomm-local-gateway`.
4. Refresh/check for updates, then install **iCOMM Local Gateway**.
5. Configure its options before starting. The first installation builds locally
   from pinned image sources and needs Internet to download images/npm packages.

There is no HACS entry and no prebuilt registry image requirement. Source and
App version updates are discovered through this repository. Both amd64 and
64-bit ARM are declared; see CI for build checks. Older 32-bit hosts are unsupported.

## Options

- `mqtt_url`: normally `mqtt://core-mosquitto:1883` for HA's Mosquitto App; use the
  actual external broker address if different.
- `mqtt_username`, `mqtt_password`: dedicated MQTT login; no embedded URL credentials.
- `device_name`: friendly MQTT device name.
- `device_profile`: currently `reselec3` only.
- `read_only`: leave true while checking reports; false enables verified controls.
- `gateway_mode`: local normally; bridge deliberately forwards to vendor cloud.
- `cloud_host`: exact observed device-service hostname; required only for bridge.
- `upstream_dns`: independent resolver for bridge to avoid rewrite loops.
- `capture_mode`: redacted normally; full is private diagnostic material.
- `discovery_prefix`: normally homeassistant.

The app's UI can save mode/cloud/capture overrides; those override App options
until **Use deployment defaults** is selected. Restart the App after editing options.
Credentials remain in private Supervisor options/runtime data, never in Git.

## Network and UI

The App publishes TCP443, TCP80 and UDP55055 on the HA host. Redirect the heater's
exact device-service hostname and `ans-field.aylanetworks.com` to the **HA host's
reserved LAN IP**, not the previous Docker server. Follow the root setup guide for
DHCP/DNS, IPv6, egress isolation, and the panel's Wi-Fi flow.

**Port conflicts matter:** another App (including a local-cloud replacement for
another appliance), proxy, or web service may already use 443 or80. You cannot
share the same address/port merely by giving the services different hostnames.
Do not stop another working App blindly. Use the standalone Docker deployment
on a different host/address when the HA ports are occupied. Remapping443 does
not make the heater connect to that new port.

Select **Open Web UI** or **Show in sidebar**. The admin UI is available only via
HA-authenticated ingress; it has no direct host port mapping. Its backend rejects
requests not from Supervisor's ingress address. Heater-facing ports remain separate
legacy compatibility services; isolate them from untrusted clients/the Internet.

## Verification and backups

Inspect startup traffic, compatible reports, authenticated UDP and MQTT status.
Only then disable read-only and verify one small supported command physically.
A data report is not expected for every keepalive; report age is shown separately.
Home Assistant discovers 18 entities. Fault31 asserts a leak and fault0 clears it.
No household automation is installed by this App.

The App stores state, keys, generated TLS certificate, UI overrides and captures
under its private `/data`. Include it in Supervisor backups. Do not uninstall or
clear App data to update it; doing so changes local identity and discovery UUID.
Full captures and backups can contain credentials and must stay private.

## Existing Compose installation

Installing this App does not import or migrate an existing Compose volume. Keep
the working installation and its backups. Migration of identity/certificates must
be planned explicitly; starting a new instance may require Wi-Fi re-enrollment.
Only one instance may serve the heater at a time. This repository update does not
move the developer's running heater or change its DNS.

## Support boundary

Local control is hardware-verified on the listed model. Fresh local startup and
keys are covered by isolated synthetic tests; a completely fresh physical heater
with no prior cloud linkage and blocked WAN remains unverified. See the repository
setup and device-support guides before testing another model.
