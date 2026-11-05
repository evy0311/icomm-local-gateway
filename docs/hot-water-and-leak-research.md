# Hot-water availability and leak detection

Investigation: November 4, 2026. No appliance settings, DNS rewrites, bridge
mode, or MQTT entities were changed for this investigation.

## Confirmed evidence

- The ResElec3 manual lists leak error 031, accompanied by a flashing light
  and audible alarm (printed pages 15 and 21):
  https://www.aosmithatlowes.com/media/1715/smart-electric-2000598248.pdf
- The locally available iCOMM Connectivity 14.1.0 Android package contains
  RE3Connected GraphQL requests for `hotWaterStatus` and strings describing
  031 as a potential water leak / Water Leak Detect Alert. This establishes
  app support for displaying that alert, not a verified local packet mapping.
- Generic app strings also mention `leakDetectionStatus` and
  `isLeakDetectionOn`; these must not be assumed to apply to RE3Connected
  merely because they appear for another device family.
- Home Assistant's existing cloud A. O. Smith integration exposes hot-water
  availability, but its dependency obtains that value from the cloud API:
  https://github.com/home-assistant/core/blob/dev/homeassistant/components/aosmith/sensor.py
  https://github.com/bdr99/py-aosmith/blob/main/py_aosmith/client.py
  The client maps LOW/MEDIUM/HIGH to 0/50/100 and inverts numeric API values.
  Neither convention identifies the local superBlockDyn1 byte offset, nor
  proves that the app's three bars are a continuous percent measurement.
- Existing private gateway captures contain superBlockDyn1 telemetry and
  setBlockParameter / periodicParameterSetting receipts. There is no separate
  named hot-water or leak property in the inspected journal. These values may
  be encoded in the existing packed reports, but their offsets are unverified.

## Verification needed before publishing MQTT entities

1. Correlate fresh local reports with the app's displayed bar count across
   normal hot-water use and recovery. Preserve timestamps and both directions
   of the transition. A single full-tank snapshot is insufficient.
2. Trace the local fault/status representation to error 031. Distinguish a dry
   sensor from missing, stale, disabled, disconnected, or invalid telemetry.
3. If a physical leak-sensor test becomes necessary, agree on a single test and
   use the specific sensor/manufacturer test procedure. Do not remotely induce
   a fault, simulate a dry-fire, disable the alarm, reset faults, or manipulate
   water valves to guess the mapping.
4. Add fixture-backed decoding and MQTT discovery only after the mapping is
   established. Use a moisture binary sensor for a verified leak state; retain
   unknown/unavailable when it cannot be determined. Expose the gauge as bars
   or a categorical level unless a genuine numeric percentage is verified.

The functioning local gateway remains in local mode. No sensor is currently
published as 'dry' or 'full' based on an unverified byte or absent alert.


## First physical leak test — November 5, 2026

A baseline was recorded at 9:01:38 AM Eastern. The owner wetted the sensor
but observed no audible alarm or other response. Inspection through 9:03:57 AM
found authenticated UDP probe responses (type 6) and keepalives (type 7), with
no HTTPS requests or fresh telemetry. The last report remained at 8:48:17 AM.
The notification connection stayed alive; no capture errors were reported.

This is an inconclusive test, not evidence of a dry sensor or a working leak
alarm. No leak field or MQTT moisture entity was inferred. Complete pre/post
captures and the timestamped observation are preserved privately. Verify the
specific sensor/test procedure before asking the owner to repeat the test.


## Confirmed leak fault and clear — November 5, 2026

The owner subsequently confirmed the physical alarm worked. In local mode the
heater sent a separate HTTPS property, not a changed superBlockDyn1 report:

- 9:15:33.509 AM Eastern: POST `properties/faultCode/datapoints.xml`, XML
  `<datapoint><value>31</value></datapoint>` (manual fault 031: water leak).
- 9:16:17.546 AM Eastern: same property, value `0` (fault cleared).

The local server acknowledged both with HTTP 200. No cloud bridge was needed.
These values are preserved in full private captures. The present telemetry
decoder/UI/MQTT ignores this separate property, so its absence from device
state does not mean the heater failed to report it. This establishes a leak
fault transition for the tested model; zero alone does not prove the sensor
is connected, enabled, or physically dry. Other fault codes need their own
mapping. Fault-report freshness must be tracked independently of temperature
telemetry when implementing MQTT moisture/fault entities.


## MQTT support deployed — November 5, 2026, 9:21 AM Eastern

Added persistent handling for `faultCode` in local and bridge modes, a numeric
HA MQTT Fault code sensor, and a moisture-class Water leak detected binary sensor.
31 asserts the leak; 0 explicitly clears it; other codes preserve the previous
leak state. Before a decisive 31/0 report the leak entity is unavailable. Reports
track separate fault/leak timestamps and never refresh temperature freshness.
Event-driven state survives restart and remains visible without temperature
updates; MQTT gateway disconnection marks it unavailable. No automatic reset
or shutoff control was added. Zero is no reported fault, not sensor health proof.

Initialized from the two matching captured device reports, with original times
and a backup. Verified in live HA: Fault code 0 (None), Water leak detected Off,
both timestamped 9:16:17 AM Eastern. Real heater was not stimulated again.
79 tests passed, covering local/bridge HTTP, invalid reports, other devices,
persistence, temperature independence, retained MQTT and discovery availability.
