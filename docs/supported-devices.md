# Supported devices

## Verified

| Model | Heater type | Reported firmware | Telemetry | Setpoint | Standard/Vacation | Notes |
|---|---|---:|---|---|---|---|
| A. O. Smith EE9-50H55DV-A | Electric resistance | 1.8 | Yes | Yes | Yes | iCOMM ResElec3; single-unit verification |

“Verified” means the physical panel, local telemetry, local command acknowledgement, and subsequent telemetry all agreed while Internet access was blocked.

## Unknown

All other A. O. Smith, State, Lochinvar, and related iCOMM models should currently be treated as unknown, even if they use a Murata radio or the same mobile app. Shared cloud branding does not prove a shared telemetry layout or command frame.

The gateway disables commands until it has decoded the known telemetry layout. That is a guardrail, not proof of compatibility: testers must still compare every displayed value with the physical panel before sending a command.

Submit results using the compatibility issue template and the process in [testing-new-heaters.md](testing-new-heaters.md).
