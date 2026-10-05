# Testing a new heater safely

Compatibility reports are valuable, but appliance control must be approached conservatively. Begin with telemetry only and never infer that a frame for one model is safe on another.

## Before testing

Collect non-unique product information:

- manufacturer and full model number;
- heater type (electric resistance, hybrid/heat pump, gas, etc.);
- iCOMM/app firmware version if displayed;
- country/region; and
- gateway host OS and architecture.

Do **not** publish the unit serial number, DSN, Wi-Fi MAC, numeric Ayla device ID, account email, tokens, or home network details.

## Phase A: network and TLS only

1. Complete the local setup with the heater-specific PF rule.
2. Keep the dashboard open, but do not send commands.
3. Watch `docker compose logs -f` for an HTTPS request.
4. Confirm that the official app reports the heater offline.
5. Confirm with a packet capture that no public connection completes.

Report whether the TLS session reaches an HTTP route. If Apache logs only a connection followed by a reset, include the Apache warning/error lines in a sanitized issue. Do not attach the certificate key.

## Phase B: telemetry compatibility

The known decoder expects five hexadecimal segments of 8, 140, 230, 52, and 52 bytes. Unknown layouts are acknowledged safely but not decoded. The dashboard will state that telemetry was received but unsupported, and diagnostics will include only segment lengths and the decoder error.

If values appear:

1. compare setpoint, mode, and vacation duration with the physical panel;
2. change one value at the physical heater—not in the dashboard;
3. verify the dashboard follows the physical change; and
4. repeat once before considering the decoder compatible.

Do not proceed if any decoded value is wrong.

## Phase C: conservative command test

Only proceed after Phase B is exact.

1. Stay at the physical heater.
2. Queue a one-degree setpoint change within the appliance manual's safe range.
3. Wait up to six minutes for fallback polling.
4. Verify the physical panel, the acknowledgement, and confirmed telemetry.
5. Return to the original value.

Test Vacation mode only if the heater manual supports it and you understand its behavior. Do not test undocumented operating modes.

## Create a diagnostic bundle

From the repository:

```sh
node scripts/collect-diagnostics.mjs
```

The script creates an ignored `diagnostics-*.txt` file and applies basic redaction. You must still read the entire file before publishing it. Search for your DSN, MAC, IP addresses, usernames, and other unique identifiers.

Never attach:

- `.env`;
- `certs/device.key` or any private key;
- `gateway-data` contents;
- an unredacted packet capture;
- raw ANS datagrams; or
- app/cloud credentials or authorization headers.

## Open the right issue

Use the **Device compatibility report** template. Include the phase reached and exact timestamps. A report that says “did not work” is hard to act on; a report that says “TLS succeeded, POST path appeared, segment sizes were X, dashboard stayed unsupported” is useful without exposing identity.

Packet captures may be requested later. If so, first reproduce on a temporary isolated network and sanitize at the packet level. When unsure, do not publish the capture—describe it privately or provide only the relevant sizes and message sequence.
