# MQTT and Home Assistant

Use an existing broker with Home Assistant MQTT discovery enabled. The gateway
does not require a second production broker. A dedicated user needs publish
access to `icomm/<instance>/#` and its discovery configuration topics, and subscribe
access to `icomm/<instance>/set/+` and `homeassistant/status` (or the configured
`DISCOVERY_PREFIX`). MQTT TLS uses normal certificate verification.

`<instance>` is the locally generated UUID in the persistent gateway volume, not
a cloud ID. Reusing the volume preserves discovery IDs across updates.

## Discovered entities

One device currently has 18 entities:

- Reported setpoint, reported mode, remaining Vacation days.
- Target temperature number, operating-mode select, Vacation-duration number.
- Wake / poll and Cancel queued command buttons.
- Fault code and Water leak detected (moisture binary sensor).
- Estimated hot-water level (provisional bars, with assumptions as attributes).
- Last report, command status, last error, gateway mode, heater connection,
  UDP connection, and read-only status.

These are number/select controls rather than a native MQTT water-heater entity
because Standard/Vacation are the actual verified modes. No Off mode is invented.
A duration change in Standard stages a preference; selecting Vacation applies it.

## Topics

Reported state is retained JSON on `icomm/<instance>/state`:

| Field | Meaning |
| --- | --- |
| `temperature`, `mode`, `vacation_days`, `received_at` | Last compatible report and original receive time |
| `fault_code`, `fault_received_at` | Numeric fault; 0 none, 31 water leak |
| `water_leak_detected`, `water_leak_updated_at` | Nullable boolean; 31 sets true, 0 sets false; other faults preserve it |
| `hot_water_estimate` | Provisional bars, inputs, method, thresholds and low confidence |
| `available` | Temperature report is fresh under the age limit; **not** overall MQTT availability |
| `telemetry_stale` | Temperature report is aged; not a disconnection |
| `heater_connected`, `telemetry_available` | Live connection and usability of saved compatible data |
| `command_status`, `error` | Delivery/confirmation lifecycle and last command error |
| `bridge` | Public HTTP/UDP/capture diagnostics, without private keys or raw packets |

Availability topics include `/gateway` (MQTT last will), `/heater` (known compatible
data plus live heater connection), `/controls`, `/temperature_controls`, `/wake`,
`/fault`, and `/leak`. Unknown values do not become zero or dry. Gateway diagnostics
remain available while the heater is disconnected. Known sensor values remain
stored privately/retained even while HA marks them unavailable.

Commands must be **non-retained**. Do not publish test faults into a real device's
state topics; they can trigger household safety notifications.

| Topic suffix | Payload |
| --- | --- |
| `/set/temperature` | Integer 95–130 (°F for the tested profile) |
| `/set/mode` | `STANDARD` or `VACATION` |
| `/set/vacation_days` | Integer 1–99 |
| `/set/wake` | `PRESS` |
| `/set/cancel` | `PRESS` |

Only one command may be pending. A receipt means acknowledged, not applied. A
matching subsequent report confirms it. A timed-out delivered command might
have applied: inspect the physical heater before retrying. Commands are never
replayed after a gateway restart. Wake asks for a command fetch, not a measurement.

## Connection and reporting

Quiet temperature telemetry is normal. Authenticated local UDP keepalives/probes
keep entities available without altering `received_at`. Once the UDP session
expires (normally around 90 seconds without valid packets), with no recent HTTP
telemetry, entities become unavailable. Bridge mode uses recent heater-facing
UDP/HTTP activity. Invalid telemetry does not become valid because UDP is alive.
Restored data becomes usable after the live session is authenticated again.

Faults have their own event timestamps, independent of temperature reports.
Code zero clears a reported fault; it does not verify the sensor is connected.
The provisional hot-water estimate is neither a real percentage nor a confirmed
physical tank-temperature reading. See its [research notes](hot-water-status-research.md).

## Optional critical leak notification

Create this separately in HA; the gateway does not send phone notifications.
The household automation used during development is not bundled with source.
Choose your actual moisture entity and `notify.mobile_app_...` action.

Recommended behavior:

1. On moisture detected, if no alert has been sent for this incident and a
   15-minute cooldown timer is idle, send one critical notification.
2. Persist an input-boolean sent flag and start a restoring 15-minute timer.
3. On moisture cleared, reset the sent flag. Do not cancel the cooldown timer.
4. Do not repeat while the same leak remains active. Reconnects must not reset
   the sent flag. A separate leak inside the cooldown is suppressed.

An iOS notification action's data can use:

```yaml
title: Water heater leak
message: A leak was detected at the water heater.
data:
  tag: water-heater-leak
  push:
    sound:
      name: default
      critical: 1
      volume: 1.0
```

The phone must allow Home Assistant critical alerts. Follow the
[Companion critical-notification documentation](https://companion.home-assistant.io/docs/notifications/critical-notifications/).
Use the automation editor and the trigger syntax supported by your installed
HA version; modern HA supports `moisture.detected` and `moisture.cleared`.
