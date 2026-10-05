# Roadmap

## Current milestone: reproducible local gateway

- [x] Local TLS termination accepted by the verified module
- [x] Internet-isolated telemetry and command path
- [x] Setpoint and Standard/Vacation control
- [x] Command acknowledgement plus telemetry confirmation
- [x] macOS proof-of-concept networking
- [x] Privacy-safe diagnostics and compatibility reporting

## Next

- [ ] Validate additional models and firmware versions
- [ ] Decode hot-water level with correlated physical observations
- [ ] Determine whether energy data exists in heater telemetry or only the account API
- [ ] Add robust multi-device handling
- [ ] Add authenticated dashboard access for non-loopback deployments
- [ ] Provide router/VLAN examples with explicit egress isolation
- [ ] Package reproducible container releases and versioned migrations

## Research

- [ ] Understand the authenticated legacy UDP notification session well enough to produce a fresh local wake-up without Ayla or per-device secrets
- [ ] Investigate a safe, supported way to change the fallback polling interval
- [ ] Map additional `superBlock` layouts from community reports

## Home Assistant / HACS

The intended direction is a HACS integration, but the boundary still needs design:

- the gateway should remain responsible for device-facing DNS/TLS/protocol behavior;
- Home Assistant should consume a stable local API and events;
- setup should clearly verify network isolation; and
- entities must expose only fields whose meaning has been confirmed.

A HACS release should wait until configuration, upgrades, authentication, diagnostics, and at least one additional hardware validation are solid.
