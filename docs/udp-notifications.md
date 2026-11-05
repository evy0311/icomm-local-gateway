> Historical research notes. Current setup, wake behavior and availability are
> documented in README.md, docs/setup-from-scratch.md and docs/mqtt.md.

# Legacy UDP notification research

Status: experimental local notification server with verified codecs and
Internet-isolated integration tests. A fresh physical enrollment with this
server remains to be verified.

## Verified envelope

The tested firmware uses 40-byte encrypted datagrams. Bytes 0–7 are an opaque
envelope retained unchanged; bytes 8–23 are the AES-CBC IV; bytes 24–39 are one
AES-128-CBC block, with padding disabled. The AES key is the first 16 bytes of
the 64-byte base64-decoded `ans-cipher-key` supplied during device lookup.

The decrypted block is version 1, type (one byte), sequence (big-endian uint16),
sender clock (big-endian uint32, advancing in milliseconds), an argument
(big-endian uint16), five reserved bytes, and CRC-8. The CRC uses polynomial
07, initial FF, no reflection and no final XOR. All 332 captured encrypted
packets examined passed CRC and byte-identical re-encoding. Captures and keys
remain private; repository tests use synthetic material. CRC validation alone
should not be described as independent cryptographic authentication.

Observed pairs are keepalive 7 / reply 8, server probe 5 / reply 6, and
notification 9 / reply 10. The initial encrypted server reply has type 2.
The initial registration uses two zero bytes, a one-byte DSN length including
its terminating NUL, the DSN, and a ten-byte type-1 message. A twenty-byte
SHA-1 digest of that complete prefix followed by the first sixteen session-key
bytes authenticates the packet. Two captured initial signatures validate.
This is a legacy keyed suffix digest, not HMAC. The packet length varies with
DSN length (49 bytes on the tested physical heater).
Keepalives request interval 30 and were observed roughly every 27 seconds.

## Bounded local-reply diagnostic

An operator may provide `ANS_KEEPALIVE_TRIAL_FILE`, pointing to a private JSON
file containing a base64 `material` field. It is only read in bridge mode.
This experiment uses the current captured vendor session material and does
not establish cloud-independent key provisioning. Do not publish that file.

After decoding a real server message, the trial substitutes exactly one
keepalive reply for that same client endpoint and opaque envelope. It copies
the request sequence, sets reply type 8 / argument zero, and advances the last
observed server clock using elapsed monotonic time. No appliance commands are
sent. Other packets retain ordinary bridging, including malformed packets,
unknown keys and stale or unmatched session anchors. Both substituted packet
bodies are recorded in full-capture mode. The next client keepalive is logged
with elapsed time and whether it repeats the prior sequence.

The physical one-reply test succeeded on 2026-11-05 UTC: the next client
keepalive arrived after 26,988 ms with a new sequence, and ordinary bridging
continued. This verifies this bounded behavior in an existing vendor session.

The trial is disabled unless explicitly configured. It is not a product
control or a substitute for completing startup/session authentication,
notifications, expiry, retransmission and recovery. Local mode ignores the
trial configuration and does not construct a cloud relay.

## Local server

Local mode now creates its own notification service, without a cloud resolver
or relay. It uses only the locally generated startup material supplied by the
device lookup handler. A valid signed registration for the configured DSN
receives type 2, its sequence, the requested interval, and a new opaque session
identifier. The framing around that identifier follows the captured envelope;
physical acceptance of a newly assigned local identifier is still pending.

Subsequent client traffic must match the endpoint, key and session identifier,
pass decryption/version/checksum checks, and avoid old sender-clock values.
Keepalives receive type 8 with their request sequence. The service sends probes
and expires idle sessions; five-second packet reordering is tolerated.

Queued commands produce type-9 notifications after session establishment. A
type-10 acknowledgment stops notification retries, while HTTPS command delivery
clears the pending notice. The wake-up notification does not carry an appliance
control frame. Unacknowledged notices are retried at four-second intervals,
up to three sends. These bounded timing choices are local implementation
policy, not a claim about every vendor firmware's required retry schedule.

Tests cover registration signatures, key/session/endpoint mismatches, stale
packets, notifications, receipt handling, expiry and real UDP sockets. A clean
Docker stack on an internal network with no Internet access completed fresh
TLS enrollment, authenticated UDP registration and keepalive, a command wake-up,
HTTPS command delivery, an empty receipt and confirming synthetic telemetry.
No captured vendor keys were used for this end-to-end test.
