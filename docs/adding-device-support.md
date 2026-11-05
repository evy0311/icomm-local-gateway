# Adding support for another device

Support is explicit, not inferred from brand or packet length. Start read-only
and keep a private record of model, firmware, observations, and confidence. A new
device can share the ResElec3 transport only after its behavior has been verified.

## 1. Establish scope and a private test environment

Record the retail model, controller/radio firmware, supported modes, documented
command ranges, and the settings visible on the physical panel and official app.
Do not post serial numbers, DSNs, MACs, account IDs, credentials, or home addresses.

Use an isolated network and a separate gateway project/address/data volume. Only
one gateway should serve a heater's rewritten endpoints at a time. Keep physical
controls available and plan how to restore the known-good DNS/service route.
Do not erase a working user's data to create a test instance.

If the device uses another protocol or has no compatible local startup flow,
write down that fact first; a different profile alone cannot implement a new
transport, provisioning system, or MQTT capability model.

## 2. Discover endpoints and capture startup

Observe DNS queries from the device. Identify its exact device-service hostname
and notification endpoint. Do not wildcard an entire vendor domain. Follow the
[setup guide](setup-from-scratch.md) for certificates, ports, and reachability.
A read-only local listener will record unknown routes but cannot promise complete
startup on an unsupported model.

For an intentional cloud baseline, set the exact `CLOUD_HOST`, select bridge
mode in Settings, and choose full capture only in a private environment. The
bridge uses an independent upstream resolver so DNS rewrites do not loop back.
It forwards requests while local appliance commands are disabled. It does use
the vendor cloud; do not describe that capture as an offline test.

Capture these events in order where they occur:

- Wi-Fi joining and the portal's visible states (record these manually; the
  gateway does not intercept phone-to-heater captive-portal requests).
- Device lookup/identity, metadata/configuration, authentication and time.
- UDP registration, keepalive, probes, and command notifications.
- Initial/changed properties, command polls, receipts, and confirming reports.
- Reconnect, restart, expired-session behavior, and errors.

Switching bridge/local mode does not renegotiate an existing radio session.
Expect mismatched keys after a mode change until the appliance enrolls with the
new endpoint. Do not publish or depend on a captured owner's cloud key to make
new installations work. Implement locally generated identity/key handling and
verify it separately.

## 3. Correlate fields with physical behavior

Change one supported setting at a time, timestamp the action, and capture both
directions (for example A → B → A). Confirm on the appliance, not just a successful
HTTP response or an optimistic app display. Do not induce unsafe conditions,
reset maintenance counters, bypass interlocks, or broaden documented ranges.

Separate targets, actual measurements, fault events, command receipts, counters,
and notification liveness. A command receipt is not a fresh measurement.
`faultCode` is a separate event property on the tested heater, not part of its
packed temperature report. Other device families may differ.

Retain unknown values as unknown. Any deliberately experimental heuristic must
have a separate, explicitly estimated name, documented inputs/thresholds,
confidence, and tests. It must not replace a verified sensor or control input.

## 4. Implement a profile

Add `src/devices/YOUR_PROFILE.mjs` and register its explicit ID in
`src/devices/index.mjs`. Select it with `DEVICE_PROFILE`; no auto-detection or
safe generic command profile exists yet.

Current profile contract:

| Member | Purpose |
| --- | --- |
| `id`, `manufacturer`, `model` | Stable profile ID and discovery metadata |
| `bootstrap` | Verified identity/model/API fields returned during local lookup |
| `reportingConfiguration` | Observed reporting subscription for that model |
| `minTemperature`, `maxTemperature`, `temperatureStep`, `unit` | Verified command bounds/units |
| `modes` | Real supported mode names |
| `decode(value)` | Validate complete payload; return reported temperature, mode, remaining days, and explicitly documented extra fields |
| `decodeFault(value)` | Validate a separate fault property; return numeric code |
| `encode(kind, value)` | Validate input; return `{ frame, target }`; throw for unsupported commands |
| `matches(target, telemetry)` | Confirm only when every requested target matches a subsequent report |

Keep device-specific byte offsets/encodings in the profile or its decoder, not
in HTTP, UI, or MQTT code. Verify full segment lengths, hex syntax, enum values,
and plausible ranges. Existing tests use synthetic buffers, not raw owner packets.

**The current capability layer is tailored to an electric Standard/Vacation
heater.** Controller validation, UI inputs, discovery modes, fault-31 semantics,
and command kinds are not yet a universal appliance abstraction. A device with
different units, modes, fault meanings, or bounds needs an explicit capability
extension across those layers and tests. Do not copy the profile and silently
inherit Fahrenheit inputs, fault31=leak, or Vacation behavior. Do not advertise
unsupported controls merely to make discovery look complete.

For an incompatible startup/notification protocol, extend `local-service.mjs`
and the relevant ANS/HTTP modules with profile-aware behavior. Unknown routes
must not receive fabricated success responses to conceal missing implementation.
Review authentication/session binding and ensure a second device cannot overwrite
or receive the first device's state/commands.

## 5. Add evidence-backed tests

Include at least:

- Confirmed report fields in both directions, malformed/truncated input, and
  unknown modes/faults.
- Command bounds and integer/enum validation; unsupported commands fail closed.
- Queue/delivery/receipt/physical-confirmation transitions, timeouts, and restart
  interruption without replay.
- Startup identity, fresh local keys, signed registration, expired/wrong sessions,
  and notification-to-poll behavior if those transports changed.
- MQTT discovery, retained reported state, non-retained commands, unknown versus
  clear leak status, and availability independent of report age.
- UI and docs matching the actual supported features.

Use original synthetic fixtures or minimal manually sanitized vectors. Do not
commit proprietary app binaries/disassembly, raw authenticated traffic, private
research tools, or copied account material. Preserve applicable source licenses.

Run `npm ci`, `npm test`, `npm run check`, `docker compose config --quiet`, and
the [disposable Docker tests](development.md). Passing synthetic tests does not
establish physical compatibility; state that boundary in the PR.

## 6. Validate locally on hardware

Return to local mode/read-only with a clean planned enrollment path, verify
reports, and only then enable the new profile's verified command subset. Keep
one command pending at most, wait for a matching real report, and restore the
owner's intended settings. Verify fault clear as well as assertion when using
an approved sensor test; never synthesize a real leak on a production MQTT topic.

Then test router-enforced Internet isolation, fresh gateway state with locally
generated keys, reconnects, gateway restart, and recovery without imported cloud
credentials. If any step is unverified, document it explicitly rather than
claiming start-to-finish cloud independence.

## 7. Submit support

Update the supported-device table and setup differences, add fixture provenance
without private identifiers, and describe physically verified versus experimental
features. Review the complete staged file list and diff. Follow
[CONTRIBUTING.md](../CONTRIBUTING.md); an issue is useful for coordination, but a
focused PR with evidence and tests can stand on its own.
