# Troubleshooting

## The phone receives a 169.254 address

Internet Sharing DHCP is not working. Do not continue with the heater. Turn Internet Sharing off and on, verify the correct source and destination interfaces, or restart the Mac. A client should receive an address on the shared subnet, commonly `192.168.2.x`.

## `bridge100` says inactive

No active client is attached to the shared Wi-Fi, or Internet Sharing did not start correctly. Join the SSID with a phone first and recheck. `bootpd` listening on UDP 67 alone does not prove the bridge is active.

## Apache warns about `CA == TRUE` or hostname mismatch

Those warnings are expected for the compatibility certificate used by the tested legacy module. A subsequent HTTP request proves the TLS handshake completed. If the heater immediately resets every connection and no HTTP request appears, open a compatibility issue with sanitized Apache log lines.

## No heater traffic appears

Check in this order:

1. `docker compose ps` shows both containers healthy/running.
2. `.env` contains the correct gateway IP.
3. `pf-local-only.generated.conf` contains the correct heater IP and interface.
4. `sudo pfctl -a com.apple/icomm-local-gateway -s nat` shows three redirects.
5. `arp -a` still maps the expected address to the heater.
6. The heater is connected to the shared SSID.

Then toggle only the heater's Wi-Fi and follow `docker compose logs -f`.

## Telemetry is received but unsupported

This is the expected safe behavior for a new layout. Do not send commands. Run the diagnostic collector and open a Device compatibility report. Segment sizes and model/firmware information are enough for the first investigation; do not publish raw telemetry immediately.

## A command stays queued

In local-only mode, allow at least six minutes. The known firmware polls roughly every five minutes plus jitter. A successful sequence includes:

```text
GET /devices/<device>/commands.xml?polling=1...
delivered local setBlockParameter command
local command acknowledged by heater
telemetry setpoint=... mode=...
```

If no command GET appears after ten minutes, cancel the command, verify ANS traffic is being contained locally, and collect diagnostics.

## A command is delivered but not confirmed

Check the physical panel. If it did not change, stop issuing commands and report the model/firmware. If the panel changed but telemetry did not, wait for the next report and inspect logs. Never repeatedly queue commands to “force” an uncertain state.

## State cannot be saved (`EACCES`)

Stop the project and recreate only its Docker volume:

```sh
docker compose down
docker volume ls | grep icomm
```

Inspect the exact volume name before removing anything. If you do remove the project volume, its saved event/command history is lost, but appliance state is not changed. Then start the project again so Docker initializes a fresh volume.

## The official app says disconnected

That is expected while the heater is isolated. The project replaces the heater-facing subset of the service; it does not emulate the mobile-account API.

## The official app remains offline after stopping

Remove the project anchor with `sudo pfctl -a com.apple/icomm-local-gateway -F all`, stop the containers, and toggle heater Wi-Fi. Confirm normal DNS and Internet access have been restored.

## Gather support information

Run `node scripts/collect-diagnostics.mjs`, read the generated file, and attach it to the appropriate issue only after verifying the redaction. Never attach `.env`, private keys, or unredacted captures.
