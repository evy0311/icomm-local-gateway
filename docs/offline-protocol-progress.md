> Historical research log. For current behavior and supported features, read
> README.md and setup-from-scratch.md. Counts and pending items below describe
> their dated milestones, not necessarily the current release.

# Offline protocol progress

Research run: 2026-11-04. Full capture enabled before Wi-Fi provisioning.
The user reported connection complete after this sequence. Times below are UTC.
Raw bodies, cloud credentials and hardware identifiers stay in private captures.

| Observed order | Exchange | Result | Local implementation |
| --- | --- | --- | --- |
| 20:22:27 | GET `/dsns/<dsn>.xml` | HTTP 200, device configuration | Missing |
| 20:22:28 | ANS session starts | Bidirectional UDP relay | Sink only; handshake not implemented |
| 20:22:28 | PUT `/devices/<id>/oem_info.json` | HTTP 422, DEV47, missing `template_version` | Missing |
| 20:22:34 | GET `/devices/<id>/commands.xml` | HTTP 200, empty queue | Implemented for ordinary property commands |
| 20:23:13 onward | Command polls | `periodicParameterSetting` property, then empty value | Report-configuration semantics not implemented |

The OEM 422 is the real cloud response, not a gateway-generated error. Do not
assume it caused failure or blindly reproduce it for every OEM update.

The lookup document includes API/model metadata, device key, registration and
setup fields, Unix time, ANS hostname and cipher key, and LAN-access flags.
The observed response says `registered=0`, `lan-enabled=false`, and
`local-access-enabled=false`. This does not by itself prove account ownership
was removed or that the response will work for a factory-fresh radio.

`periodicParameterSetting` is a 233-character comma-separated numeric string
in the observed populated command. Some later commands have an empty value.
Its timing and exact meaning must be established from reports/acknowledgments;
its name alone is insufficient evidence to generate a replacement.

At inspection, compatible telemetry still had its earlier timestamp. UDP
traffic and successful polling show transport activity, not fresh heater state.
The official-app round trip subsequently succeeded: at 20:26:50 UTC the
129°F command was delivered, acknowledged, and followed by telemetry at
20:26:51. At 20:27:10 UTC the 130°F command was delivered, acknowledged, and
followed by telemetry at 20:27:11. The gateway reports fresh telemetry and
130°F. The private full journal was exported after both transitions.
This verifies the bridge path; it does not yet verify cloud-free startup.

## Implementation order

1. Complete: captured a successful 130°F → 129°F → 130°F round trip after
   fresh provisioning, including property acknowledgments and telemetry.
2. Complete in source: local HTTP request/response journaling, including
   unknown bootstrap routes and capture-error handling. 39 tests pass; the
   disposable Docker TLS/MQTT smoke test passes. Active bridge not restarted.
3. Implement narrowly scoped device lookup/configuration and enrollment state,
   using local identity and generated secrets rather than replayed cloud tokens.
4. Implement the observed notification handshake or verify a supported polling
   fallback. A raw UDP sink is not an ANS replacement.
5. Add the required report-configuration/property behavior from evidence.
6. Test local mode read-only first; require fresh telemetry before commands.
7. Enable local commands in a deployment without the read-only test override.
   Confirm physical state and fresh telemetry for setpoint, Standard, Vacation.
8. Block internet egress for heater and gateway, repeat setup with a separate
   empty gateway volume, and test recovery. Preserve the working bridge volume.

Do not claim fully offline setup until step 8 passes without an account or
preloaded cloud credentials. If panel Wi-Fi reset leaves radio credentials,
document that limitation separately from empty-gateway validation.

## Vacation verification

On 2026-11-04 at 20:28:34 UTC, the bridge delivered the vendor Vacation
command for 3 days. The heater posted its property acknowledgment and then
reported VACATION, 3 days, 50°F at 20:28:35 UTC. At 20:28:54 UTC it received
the vendor Standard command, acknowledged it, and reported STANDARD, 0
vacation days, 130°F at 20:28:55 UTC. Both command frames exactly match the
existing local encoders. Full captures were preserved privately. This verifies
the mode protocol against the physical heater through the bridge; local-only
transport and startup still require testing.

## Polling fallback research

Ayla documents a client poll interval when ANS is not used, and its ESP32 agent
describes polling when ANS connectivity is lost:

- https://docs.aylanetworks.com/docs/ayla-module-mcu-interface
- https://docs.aylanetworks.com/docs/ayla-esp32-solution

This supports testing a polling-only local path before implementing full ANS.
It does not establish the fallback behavior or interval of this ResElec3
firmware. The earlier statement that every local command necessarily requires
a working local UDP notification service was too strong. Device startup and
fresh telemetry are still required. The published Linux-agent reference GitHub
URL is currently unavailable; it is not a usable implementation source.

No live local-mode switch or physical command was performed during this source
change. Bridge mode remains the active configuration.

## Local startup trial implementation

Implemented and deployed in read-only local mode on 2026-11-04:

- `src/local-service.mjs` answers the observed DSN lookup route, persists a
  locally generated numeric identity and 64-byte notification secret, and
  rejects a different DSN after enrollment. Existing numeric IDs are retained
  when migrating a previously learned device. No cloud tokens are copied.
- Local time and model/API metadata are generated from local state/profile.
  OEM metadata updates are accepted as valid JSON objects without persisting
  arbitrary supplied fields. This behavior is experimental, not a claim that
  every vendor validation error has been reproduced.
- The observed subscription bitmap is sent on the initial command poll and
  after a DSN lookup. Its individual bits and rate have not been inferred.
- HTTP and HTTPS are served in local mode; local HTTP replies and incoming UDP
  packets are fully journaled. Unknown routes remain explicit failures.
- Local mode constructs no cloud resolver or forwarding client. UDP still has
  no authenticated local response; polling fallback remains unproven here.

Validation: 42 tests pass, including fresh local enrollment without imported
credentials, persistence, mismatched-device rejection, startup/telemetry HTTP
flow, and capture failure handling. The disposable Docker TLS/MQTT smoke test
also passes. None of these synthetic tests establish physical offline support.

The real heater trial is now local/read-only with full capture. Configuration,
state and pre-trial captures were backed up privately. Fresh local Wi-Fi setup
and telemetry are the next physical checkpoint; no local appliance command
has been sent. `compose.offline-test.yml` provides a container-egress-isolated
test network, but physical-heater egress must be blocked separately at the
router for final acceptance. This network override has not been applied to
the active trial.

## Physical startup: device metadata update

During the local setup trial, the heater repeatedly PUT `/devices/<id>.xml`
with firmware version, LAN address and Wi-Fi SSID. This previously received
404, preventing progress. A scoped metadata update handler now validates XML,
rejects unsupported/identity fields and wrong device IDs, persists these fields
privately, and returns the updated device document. Subsequent lookup reflects
the firmware version. No appliance setting is changed by this handler.

43 tests pass. Deployed to the local read-only trial: the physical heater then
received 200 for its update and immediately fetched `/commands.xml` locally.
Fresh physical telemetry and final portal status are still unconfirmed.

Synthetic fresh startup also passes over TLS inside an internet-isolated Docker
network, using a new empty gateway volume. This proves only the synthetic
server flow; it does not replace the physical heater offline acceptance test.

## Physical local telemetry and fallback polling verified

With bridge mode off, the physical heater polled commands at 21:46:17 UTC and
21:51:22 UTC (approximately five minutes apart). It posted two decoded 129°F
reports at 21:51:35 UTC and a 130°F report at 21:51:38 UTC, all answered locally
with HTTP 200. Availability became fresh. No UDP response or cloud forwarding
was used. This verifies the physical telemetry path and polling fallback, not
yet local command execution or internet-isolated first installation.

A private full capture was preserved. For the next command trial,
`compose.control-test.yml` explicitly opts into commands after `compose.test.yml`.
The gateway was recreated with that override; commands remain blocked until a
new compatible report arrives after restart. Default/test configurations still
remain read-only. No appliance command has been sent in this trial yet.

## First local command trial: not confirmed

A fresh 129°F report allowed a local 130°F command to be queued. The heater
polled it at 21:56:28 UTC and posted an empty setBlockParameter response.
Both the physical display and last report remained 129°F. The empty response
also occurs in successful vendor exchanges, so it is receipt evidence only.
The command XML was byte-for-byte identical to the successful vendor command.

The bridge captures show `x-ayla-auth-key` responses equal to the token portion
of the incoming `Ayla1.0 <token>` header, consistently across all 29 captured
cloud responses. The local server now reproduces that echo only for the
observed strict format, and matches the XML UTF-8 content type. No captured
credential is hardcoded or imported. This is a candidate compatibility fix,
not a proven cause. 44 tests and the disposable Docker TLS/MQTT smoke test pass.

The host's LAN address changed during the trial. Redeployment failed when
Docker could no longer bind its former address. The gateway and TLS endpoint
were restored on the current LAN address; both exact AdGuard rewrites must
be updated to match. Retry only after DNS is corrected and fresh telemetry
arrives. Restart marks the previous delivered command interrupted rather
than replaying it. A stable host DHCP reservation is required for reliable use.

## Reconnect after host-address change

The heater reached the current gateway after captive-portal reprovisioning.
It looked up the device, then repeatedly sent a 57-byte XML update with an
empty `<device>` element. Because persisted metadata already matched, there
were no changed fields. The prior validator rejected this as a scalar value.
An empty device element is now accepted as a no-op; unrelated roots, arbitrary
scalar content, unsupported fields and wrong identities are still rejected.
45 tests pass. The fix was deployed while the heater continued its retries.

## Explicit diagnostic command without fresh telemetry

At the user's request to test local control without further physical-panel
changes, the loopback admin command API now accepts an explicit boolean
`allow_stale` for a temperature command to an already identified local heater
with previously decoded telemetry. Normal UI/MQTT commands retain the fresh
telemetry requirement. Read-only mode, temperature limits, one pending command,
timeout, no automatic replay, and confirmation by a fresh post-delivery report
remain enforced. Cached state is never relabeled fresh by this override.

47 tests pass, including stale-state delivery, range/mode/read-only rejection,
timeout and final confirmation. A new explicit 130°F diagnostic request was
accepted locally; its outcome is still being observed. No forced UDP poll
was sent: authenticated local notification generation remains unimplemented.

## Comparison against unchanged original repository

Verified the reference clone matches remote HEAD 3c94b3a. Its protocol.mjs and
decoder.mjs are byte-for-byte identical to the new gateway's copies. A separate
container ran the unchanged original gateway.mjs, using its own persistent
volume and a full-capture preload wrapper. Only the heater-facing TLS upstream
was temporarily redirected; no original repository files were edited. Its
cache was initialized from the actual prior 129°F report with the original
report timestamp retained. The original API queued 130°F; the heater collected
it at 22:32:43 UTC and posted an empty property response. The original marked
receipt acknowledged, but it also received no new 130°F telemetry in this
connection state. Its private state/journal were archived and the container
was stopped without deleting its volume.

The original has no DSN lookup or device enrollment handler and does not
require ANS replies for its verified command path. Its historical working
control result should not be conflated with a cloud-free fresh enrollment.

Comparison of startup responses exposed avoidable differences: the new service
generated a nonempty phone setup token where the captured working lookup has
an empty setup-token, and generated a registration token with a different
length. The service now leaves setup-token empty, generates a six-character
local registration token, migrates the prior generated values on lookup, and
does not inject reporting subscriptions on the default command path. The
subscription bitmap remains opt-in for isolated research. 49 tests pass.

An explicit local diagnostic refresh can return a single HTTP 401 on the next
command poll to test client reauthentication without physical button actions.
It does not consume a queued appliance command. Whether this firmware performs
a new lookup in response remains an observation, not an assumed success. The
corrected gateway was restored and a local refresh plus 130°F test was queued.

## End of comparison and diagnostic cleanup

The temporary original service did not produce fresh telemetry confirming the
130°F change either. The source comparison eliminated frame/XML differences,
but did not prove a successful fix. The six-character registration-token and
empty setup-token corrections remain; the automatic subscription injection is
off by default to match the original command-only behavior.

The software relookup experiment produced command retries and pings rather
than a new DSN lookup, so it was removed from the API and transport. The
captured notification-key comparison was likewise removed from active state
without claiming success. All private comparison archives are retained.
48 tests pass after removing the failed diagnostic path. The original service
is stopped and the normal local gateway/TLS routing is restored. Unconfirmed
commands are interrupted on restart and are not replayed.

A proposed temporary cloud-bridge recovery check was blocked by automatic
approval review before execution because it would forward authentication and
telemetry to Ayla. No bridge switch occurred. The gateway remains local-only.
Cloud recovery is a separate diagnostic requiring explicit approval, not a
completed offline feature or a silent fallback.

## Approved bounded bridge check

After explicit user approval, the gateway entered bridge mode at
23:12:36 UTC and returned to local mode at 23:14:36 UTC. No appliance
commands were submitted. No heater HTTP requests or UDP packets arrived
during this window, so the experiment did not exercise cloud forwarding or
verify session recovery. The last captured heater activity predates the
window; the lack of a request in two minutes is not evidence of a broken
bridge, especially given the previously observed roughly five-minute polls.

The heater still responds to LAN ping and both configured DNS rewrites point
to the current gateway host. Runtime settings and public state both confirm
local mode after restoration; full capture remains enabled with zero capture
errors. The UI still holds the old 129°F report and marks it unavailable.
Full offline control remains unverified. The complete private journal was
exported separately and is excluded from public source artifacts.

## Original command-receipt compatibility correction

The original gateway accepts an empty POST to the setBlockParameter datapoint
route as a command receipt. The new controller had required the response to
echo the complete command frame, leaving actual empty receipts marked only
as delivered. The HTTP adapter now explicitly identifies empty-body receipts;
the controller accepts them only for an already delivered command. A receipt
does not confirm the target: fresh matching telemetry is still required.
The /ping response now also uses the original application/json content type.

The real HTTP regression exercises an empty receipt before delivery (ignored),
after delivery (acknowledged), and a subsequent report (confirmed). All 48
tests pass. A separate disposable Docker TLS/MQTT smoke check passes. Both
changes are deployed locally, cloud forwarding remains disabled, and the
requested 130°F diagnostic command is queued for the next real heater poll.
At deployment, no heater traffic had arrived since the earlier 22:48 UTC
activity; a successful physical change has not yet been observed.

Live transport checks after deployment show the LAN HTTPS endpoint responds
and the heater responds to ping, but the last real command poll is still
22:48:17 UTC and the last notification packet 22:48:33 UTC. Local read-only
Wi-Fi/status endpoints return 404. Host packet capture requires administrator
access that is unavailable noninteractively; no firewall rules or network
settings were changed. The queued command cannot be evaluated until the
heater resumes contacting the gateway. Empty-receipt compatibility is a
verified software correction, not proof of a physical setpoint change.

## Fresh bridge recovery and decoded UDP session

After the user restarted the heater, a fresh device lookup, telemetry and
bidirectional notification session were captured beginning 23:58 UTC. The
reported physical setpoint is 130°F. Full captures have zero recording errors.

The notification envelope and cipher were decoded: AES-128-CBC using the
first 16 bytes of the 64-byte startup material, an explicit 16-byte IV, no
padding, and a 16-byte message with CRC-8 polynomial 07 / initial FF. All 332
examined encrypted packets validate and re-encode byte-for-byte. Sender clock
progression is 1,000 ticks per second. A codec and bounded one-reply bridge
diagnostic were added with synthetic fixtures; all 55 tests pass.

The diagnostic was deployed with private current-session material. At
00:11:14 UTC it generated a type-8 keepalive reply locally, rather than
forwarding that particular request to the vendor. All other traffic retains
ordinary bridging. The next heartbeat is being observed before interpreting
this as accepted. This does not yet implement local initial registration or
prove a fully offline notification server.

At 00:11:40.993 UTC the heater sent its next keepalive 26,988 ms after the
local reply, with a different sequence number. The ordinary vendor bridge
then returned a valid type-8 reply. This supports acceptance of the generated
local keepalive in the current session, without an immediate retry. It is
not proof of local initial registration or independence from vendor-supplied
startup material. The one-shot trial is exhausted; all subsequent packets
continue through the bridge. The final image also passes the independent
Docker TLS/MQTT smoke test. Complete startup and trial journals are archived
privately; no session material or captured packet vectors enter public source.

## Full experimental local notification service

The initial registration signature is now verified as SHA-1 of the packet
prefix followed by the first sixteen startup-key bytes. Both captured initial
packets validate. The server checks DSN, signature, client endpoint, assigned
session identifier and encrypted packet integrity. Short packet reordering is
tolerated; old sender clocks and replayed registrations outside the active
idempotent retry are rejected. Registration replay memory is bounded and
process-local; persistent replay protection remains a future hardening item.

Local mode now starts a notification service using its own generated keys. It
answers registration/keepalive traffic, probes the client, expires idle
sessions and emits queued-command notifications with bounded retries. A fresh
Internet-isolated Docker fixture successfully completed lookup, local-key UDP
registration, heartbeat, notification, TLS command delivery, empty receipt and
confirming synthetic telemetry. All 61 regression tests pass. A generated
opaque local session identifier still needs physical acceptance testing.

The working bridge state/capture and previous image were preserved before
deployment. No heater commands are queued for the upcoming physical restart.

## First physical local attempt: published TLS failure

The user restarted the heater at approximately 00:26 UTC. It performed DNS
queries and sent initial UDP registrations, but no HTTPS enrollment reached
the gateway. The registrations do not validate with the local key, which had
not been fetched. The heater subsequently resumed a cached HTTPS command poll.
No command was queued or applied.

A direct host-to-LAN HTTPS request reproduced connection resets, while an
internal Docker HTTPS request returned 200. Recreating only the TLS frontend
at 00:31:38 UTC restored the actual published LAN HTTPS endpoint to 200. This
localizes the failure to the published TLS path; it does not establish the
precise Docker/proxy root cause. A deployment helper now checks that LAN path
and recreates the TLS frontend once if needed, before any heater restart.
The heater still needs a successful new device lookup to receive the local
keys before its local UDP registration can be evaluated.

## Local control verified — November 5, 00:51 UTC

The physical ResElec3 heater accepted locally generated enrollment/ANS key
material with bridge mode off. Initial registration failed because the server
assigned a 32-bit session identifier while this firmware echoes only its low
16 bits. Session identifiers now fit that field. Authenticated client probes
receive type-6 replies; authenticated packets can update the UDP return port
(the Docker forwarding layer changes it). Local keepalives use type 7/8,
server probes use 5/6, and command notifications use 9/10.

The gateway recovered the active session from its private signed registration
and encrypted packets without another heater reset. Normal restarts now retain
that session in a separate mode-0600 file, validate it against current local
keys, preserve the server clock, and await a fresh authenticated packet before
sending notifications. Expired sessions and old keys cannot be resumed.

The real heater fetched a local 129°F command, posted an empty-value XML
receipt, and reported 129°F at 00:51:10 UTC. A second local command restored
130°F, confirmed by a fresh report at 00:51:34 UTC. Neither HTTP nor UDP used
a cloud bridge. Receipts alone are never treated as confirmed temperature.
The captured periodicParameterSetting subscription is now sent during local
startup; this changes reporting configuration, not the temperature target.

All 63 automated tests pass. A disposable Docker network with Internal=true
passed fresh enrollment/key generation, TLS, signed registration, keepalive,
UDP notification, command fetch, XML receipt, and confirming telemetry with
container internet egress disabled. This synthetic fixture is distinct from
physically blocking the heater's own WAN connection. Full factory-reset setup
on a heater that has never been cloud-linked and a physical WAN-isolation test
remain unverified; do not describe those as completed.

Gateway restarts preserve UDP connectivity but the UI conservatively requires
a new compatible telemetry report before showing the heater as available.
Published LAN TLS is checked after deployment; Docker Desktop occasionally
requires the TLS frontend alone to be recreated, which deploy.sh handles.
Full private captures are retained and excluded from the source archive.

Final deployed-version verification after restart, 00:54 UTC: the physical
heater confirmed 129°F at 00:54:51, 130°F at 00:54:53, Vacation/3 days at
00:54:55, and Standard/130°F at 00:54:57. The saved vacation-duration helper
was restored to its prior seven-day preference without changing Standard mode.
The private MQTT broker's retained state matches the fresh final HTTP state:
available=true, temperature=130, mode=STANDARD, command_status=confirmed.
There were zero UDP rejections, send errors, or capture errors in this final
session. Full verification captures were exported privately.

## Home Assistant MQTT deployment verified — November 5, 01:04 UTC

The real gateway now connects directly to Home Assistant's existing Mosquitto
broker using a dedicated login from its private environment file. The test
broker override is excluded; deploy using compose.yml plus compose.ha.yml.
Home Assistant discovered fourteen entities under A. O. Smith water heater.
The last-report timestamp and connection diagnostics remain available while
telemetry is stale. Full public diagnostics remain in the retained JSON state.

A fresh report confirmed 129°F at 01:03:39. Home Assistant's number.set_value
then set 130°F through MQTT. The HA Vacation-duration number was set to three,
and the HA mode select activated Vacation, confirmed by physical telemetry
at 01:04:15. The HA mode select restored Standard/130°F, confirmed at 01:04:38.
The saved duration preference was restored to seven. Final status was available,
local mode, commands enabled, confirmed, with zero UDP/capture errors. All 64
regression tests pass. No cloud integration or existing LG device was changed.

## Explicit wake / poll verified — November 5, 13:36 UTC

Added the local UI/API/MQTT wake action, available with authenticated UDP even
when temperature telemetry is stale. The physical heater acknowledged its
notification at 13:36:49.545 UTC and requested commands at 13:36:49.556 UTC,
38 milliseconds after the request. State records `poll_status=fetched` without
marking telemetry fresh or changing an appliance setting. Keepalive/probe
exchanges continued afterward. All 67 regression tests pass, including retained
MQTT rejection, rate limiting, stale/expired session rejection, bounded retries,
and preservation of pending appliance command identity.

## Stale-report temperature control verified — November 5, 13:48 UTC

The local UI/API/MQTT now permit an explicit bounded temperature target for a
previously identified compatible heater even when telemetry is stale. Sensor
availability remains tied to fresh reports; mode controls retain that requirement.
Read-only, unknown/incompatible devices, temperature limits, one pending command,
expiry, and report-only confirmation remain enforced. Pending commands are not
replayed after restart. All 69 regression tests pass.

Recovered the current session from the authenticated fresh bridge handshake
without a heater Wi-Fi reset. The user then exercised temperature updates: the
heater fetched the command at 13:48:16 UTC, posted its receipt, and sent a new
130°F Standard report at 13:48:17 UTC. Final state was available=true,
temperature_commands_enabled=true, command_status=confirmed, local mode,
zero UDP rejections/send errors/capture errors in this session.

The temperature-like research fields in segment 2 at offsets 0 and 2 are
unchanged between the 13:42:18 and 13:48:17 reports (raw 13796 and 12089).
Interpreted as unsigned 8.8 fixed-point, they yield 53.891 and 47.223. Their
roles and relationship to LOW/MEDIUM/HIGH remain unverified. The private
candidate timeline preserves these values without publishing guessed sensors.
