# Supported devices

| Model | Profile | Firmware tested | Evidence |
| --- | --- | --- | --- |
| A. O. Smith EE9-50H55DV-A | `reselec3` | 1.8 | Physical local target, Standard/Vacation, MQTT controls, UDP notification/keepalive, and fault31 → 0 leak transition |

Other models/firmware are unverified. Packet length alone does not justify using
this profile. The device-support guide explains how to add a different model.

Hot-water bars are a separately labeled estimate. Valve control, energy use,
heating-element activity and actual labeled tank-temperature measurements are
not implemented. First-time physical provisioning with all WAN access blocked
remains an acceptance-test gap, despite passing isolated synthetic startup tests.
