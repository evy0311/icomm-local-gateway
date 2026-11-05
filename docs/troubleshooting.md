# Troubleshooting

Check the gateway first; avoid repeated trips to reset the heater.

| Symptom | Check |
| --- | --- |
| Port bind error | Another host service uses 80/443/55055; use a separate address/host or resolve that service conflict. DNS does not change ports. |
| Container healthy, no heater HTTPS | Run `deploy.sh` with the actual host LAN IP. It checks the published 443 endpoint and repairs a Docker Desktop TLS frontend forwarding failure. |
| No traffic at all | DNS query log filtered to heater IP; exact rewrites; DHCP DNS; cached addresses; IPv6/alternate DNS; host firewall; host asleep. |
| Official app works with bridge off | The heater may be bypassing rewrites. Verify actual traffic and enforce client-specific Internet isolation rather than assuming DNS blocks the cloud. |
| `cloud_connecting` or portal closes | Inspect startup exchanges and fresh reports. Portal labels alone do not establish local success. |
| UDP rejected after mode switch | Existing heater/session credentials may belong to the previous endpoint. Mode switching does not re-enroll the radio. Plan a Wi-Fi reconnect after verifying gateway reachability. |
| UDP alive, old temperature | Reports are event-driven. Keepalives prove connection, not new measurements. Preserve original receive time. |
| Entities unavailable | Check broker/gateway availability, authenticated UDP, compatible initial report, selected profile, and read-only controls. A quiet 15-minute period alone should not hide values. |
| Command acknowledged, not confirmed | Wait for a matching report and check the physical display. Receipt/HTTP200 is not proof of application. Do not flood retries. |
| Command timed out | Fifteen-minute TTL expired. Delivered commands might still have applied; inspect before retrying. |
| Controls unavailable | Local mode, `READ_ONLY=false`, compatible known data and connection. Test override forces read-only and changes MQTT broker. |
| `.env` mode change ignored | Saved UI settings in runtime storage override mode/cloud-host/capture defaults. Use deployment defaults or edit Settings. |
| App offline in local mode | Expected if the vendor cloud is isolated; use gateway/HA. Physical alarm behavior is independent of the gateway. |
| Leak/fault entity initially unknown | No decisive fault event has arrived. Do not default it to dry or generate fake production faults. |
| No physical leak alarm | Follow the model/sensor manual and verify hardware. Network captures cannot establish a functional physical alarm. |

## Safe diagnostics

Read `/health`, `/state`, and the UI's Traffic page. Use `docker compose logs`
locally and inspect capture-error counts. Preserve original timestamps.
Export a private journal with `scripts/export-capture.sh`; full captures can contain
credentials and must not be attached to a public issue. Share manually reviewed,
minimal synthetic/sanitized examples instead.

Do not delete the working data volume to repair a network problem. Back up the
private state/certificates first if testing a separate clean instance. An instance
that has learned a real ID must never receive synthetic smoke-test requests.
