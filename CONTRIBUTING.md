# Contributing

Work only with devices, accounts, and networks you own or are authorized to test.
Start with [Adding device support](docs/adding-device-support.md) and
[Development/testing](docs/development.md).

## Evidence and scope

Keep model-specific offsets and frames in profiles/decoders. Validate formats,
ranges and modes; unsupported devices must not receive guessed commands. A new
model may need an explicit capability/transport extension, not just a copied profile.
Correlate physical changes in both directions, and distinguish acknowledgment
from application. Keep diagnostic bridge mode explicit; local mode must not
silently fall back to the vendor cloud.

Unverified fields stay unknown. An intentionally estimated feature must have a
separate estimated name, confidence, assumptions and tests, and must never be
presented as a verified physical measurement or safety input.

Do not broaden appliance limits, invent Off commands, bypass interlocks, reset
maintenance counters, or automatically replay commands. Keep command expiry,
read-only mode, single-device binding and interruption behavior covered by tests.

## Privacy

Never commit `.env`, keys, persisted identity/session state, raw captures, passwords,
DSNs, serial/MAC numbers, numeric cloud IDs, home IPs, authenticated UDP packets,
proprietary app bundles/disassembly, or private reverse-engineering tools. Full
captures belong in private storage, never issue attachments or source packages.
Fixtures must be original synthetic data or carefully sanitized minimal vectors.
Preserve MIT and other applicable attributions.

## Pull requests

Run `npm ci`, `npm test`, `npm run check`, `docker compose config --quiet`, and
`sh scripts/test-docker.sh` for transport/MQTT changes. Use a disposable instance;
never point synthetic tests at a real heater's instance.

Before submission, inspect the entire diff and staged file list. Explain the
problem/model, evidence, verified versus experimental behavior, privacy review,
tests, and compatibility/safety implications. Keep household deployment settings
and HA automations separate from device support. A coordination issue is useful
for a new model but a focused, tested PR is welcome without a duplicate issue.

The `initial-research` branch preserves the original implementation. New gateway
work targets `main`; do not overwrite research history to update the current app.

For Home Assistant App changes, regenerate the allowlisted context with
`node scripts/sync-ha-app.mjs`, bump the App version and changelog for a published
App update, and verify ingress and both supported image architectures. Do not
place credentials or runtime files in the App's generated build context.
