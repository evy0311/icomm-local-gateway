## Summary

Describe the change and the observed evidence supporting it.

## Validation

- [ ] `npm test`
- [ ] `npm run check`
- [ ] `docker compose config`
- [ ] Physical-device validation, if applicable, used an owned/authorized heater

## Privacy and safety

- [ ] No DSNs, serial numbers, MACs, cloud device IDs, credentials, private keys, account data, personal paths, or authenticated packet bodies are included.
- [ ] Unknown devices still fail safely without receiving guessed commands.
- [ ] Any newly labeled telemetry field was correlated with a known physical state.
- [ ] The default gateway remains local-only and does not contact Ayla.
