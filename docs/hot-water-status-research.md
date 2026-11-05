# Hot-water status: app behavior and local traffic

Investigation: November 5, 2026. Gateway remains in local mode. The initial
research was read-only; the provisional estimate described below was subsequently
added at the user’s request. No heater settings change is required.

## App evidence

The locally supplied iCOMM Connectivity 14.1.0 Android APK contains Hermes v96
bytecode. Static disassembly establishes:

- The RE3Connected GraphQL fragment explicitly requests `hotWaterStatus`.
- The app's `hotWaterStatusType` validates exactly LOW, MEDIUM, and HIGH.
- The dashboard passes `device.data.hotWaterStatus` to its status component,
  defaulting to LOW when the value is missing.
- The HotWaterStatus component maps LOW -> 2, MEDIUM -> 1, HIGH -> 0 for an
  animation covering a 0-to-3 input range and a 0-to-270-degree rotation.
  These numbers are display indices, not a confirmed on-wire heater enum.
- No superBlockDyn1 reference was found in the app bundle. The inspected UI
  consumes a cloud-prepared status; this does not reveal the cloud's algorithm
  or the heater's byte layout.

This verifies the app's input/display contract, not a fresh response from the
user's account. No Android device was connected over ADB during inspection.
The app's LOW fallback is not evidence that an offline heater is actually low.
The existing HA cloud client's numeric-percent conversion must not be applied
to an unverified local byte.

Private research artifacts outside the gateway source contain the original
bundle hash, disassembly, and relevant function references (11573, 11607,
15602, 15604, 15605). No proprietary bundle or disassembly is shipped with the
public source archive.

## Existing traffic

The saved gateway journal contains 23 superBlockDyn1 reports between
2026-11-04 20:26:51 UTC and 2026-11-05 01:04:38 UTC. All have five segments
of 8, 140, 230, 52, and 52 bytes. Reported property names contain no separate
hot-water level property. The control receipts are distinct from telemetry.

In segment 2, zero-based byte offsets 0..1 and 2..3 interpreted as big-endian
unsigned 8.8 fixed-point values vary independently of the confirmed setpoint:

- Offset 0: approximately 53.3 to 55.0 in Celsius-like units.
- Offset 2: approximately 41.1 to 53.3 in Celsius-like units.

These are research candidates for physical temperatures, not confirmed upper
or lower thermistors. Other changing status bytes include offsets 64, 65,
89, 91, and 93. Setpoint/mode changes and counters are confounders. None of
these fields is labeled as hot-water level or exposed through MQTT.

There are no timestamped app gauge observations paired with these 23 reports.
They cannot establish a Low/Medium/High mapping by themselves. The current
gateway has stale telemetry, so a fresh live comparison is not yet available.

## Next comparison

1. Read the official app's bar count and its online/last-updated status first.
   No heater reset is needed just to inspect the app.
2. If the app has a genuinely current value, timestamp it against the nearest
   local report, then repeat across ordinary hot-water use and recovery.
3. If the app is offline or cached, do not label current local packets with
   that stale value. A temporary bridge session or an authenticated read-only
   cloud snapshot may supply labels, but static app inspection alone cannot.
   Plan that separately; changing to bridge may require a new cloud handshake
   because the current local session uses locally generated notification keys.
4. Publish a categorical MQTT sensor only after multiple independent matched
   transitions establish its source. Do not invent a percentage from three
   categories, and preserve unknown/unavailable on stale or invalid reports.

## First user observation — November 5, 8:50 AM Eastern

The user reports that the official app currently displays three bars. The app's
last-updated timestamp was not supplied. The nearest local reports at 8:48:13
and 8:48:17 have the same research candidates as the last captured cloud report
at 8:42:18: segment-2 words at offsets 0/2 are 13796/12089; status bytes
64/65/89/91/93 are 1/0/8/8/0. This is one baseline observation, with app freshness
unverified. It does not prove that any particular byte means three bars, nor
that the cloud uses the two temperature-like values to calculate that level.
Next, obtain an independently fresh lower-bar observation and a nearby heater
report during ordinary water use, then a recovery observation. No artificial
draining, heater setting change, Wi-Fi reset, or guessed MQTT sensor was used.


## Provisional local estimate (opted in by the test owner)

The owner requested an inferred reading while waiting for normal shower use to
supply lower-level observations. The gateway now publishes **Estimated hot-water
level**, explicitly marked provisional with low confidence, separately from any
confirmed manufacturer status. This is not the app's reverse-engineered algorithm.

Method `temperature-deficit-v1` reads the unverified temperature-like word in
segment 2, zero-based byte offset 2, as unsigned big-endian 8.8 Celsius and compares
its Fahrenheit interpretation with the confirmed reported setpoint:

| Deficit below setpoint | Assumed bars | Assumed label |
| --- | --- | --- |
| At most 15°F | 3 | High |
| More than 15°F, at most 30°F | 2 | Medium |
| More than 30°F | 1 | Low |

These thresholds were chosen for a starting heuristic. Only the three-bar baseline
has an app observation, whose freshness was not independently verified. Neither
lower threshold nor the candidate's physical meaning is confirmed. The baseline
word 12089 reads about 117°F against a 130°F setpoint, giving an estimated 3 bars.
It is not an actual tank-temperature sensor, volume estimate, percentage, or safety
input. Vacation mode and missing/implausible inputs produce unknown, never zero.
Changing a setpoint can change this estimate without changing stored hot water.

MQTT state includes `hot_water_estimate` with nullable `bars`/`level`, raw candidate,
interpreted candidate, deficit, method, thresholds, reason, `provisional: true`,
and `confidence: low`. The HA sensor carries these attributes and uses the same
fresh-report availability as other telemetry. The UI labels cached values when
reports are stale; command acknowledgments and UDP keepalives do not refresh them.
Do not use this experimental sensor for control automations until validated.

After ordinary showers, compare the app bar count with a nearby fresh gateway
report and note both times. Repeat during reheating. Preserve mismatches rather
than treating guessed labels as observations; refine or replace the heuristic
when those comparisons establish the real relationship. No artificial draining,
Wi-Fi reset, or temperature change is needed for this validation.
