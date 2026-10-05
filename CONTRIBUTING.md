# Contributing

Thank you for helping make local control more reliable and less dependent on a discontinued or unavailable cloud service.

## Ground rules

- Work only with devices, accounts, and networks you own or are authorized to test.
- Do not submit credentials, tokens, private keys, DSNs, serial numbers, MAC addresses, numeric cloud device IDs, home IP addresses, or authenticated packet bodies.
- Do not label a field from shape alone. A value needs repeatable correlation with a known physical state before it becomes a named entity.
- Do not broaden command ranges without appliance documentation and captured, physically verified results.
- Keep the default path fully local. Code that silently contacts Ayla or another public service will not be accepted.
- Preserve a safe failure mode: unsupported devices may report metadata, but should not receive guessed commands.

## Reporting compatibility

Follow [docs/testing-new-heaters.md](docs/testing-new-heaters.md) and use the Device compatibility issue template. Include model/firmware, the test phase reached, and a manually reviewed diagnostic bundle.

## Development setup

The gateway has no runtime npm dependencies:

```sh
npm test
npm run check
docker compose config
```

When changing protocol code, add tests based on at least two observed transitions when practical. Synthetic test fixtures must not contain identifiers copied from a real heater.

## Pull requests

A focused pull request should explain:

1. the observed behavior or problem;
2. what evidence supports the change;
3. how privacy-sensitive input was sanitized;
4. tests performed; and
5. safety or compatibility consequences.

Documentation changes are welcome, especially setup instructions for isolated router/VLAN environments that do not weaken the egress-blocking requirement.
