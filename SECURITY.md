# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose heater owners, credentials, device identity, private keys, or network access. Use GitHub's private vulnerability reporting feature for this repository when available.

Include a concise impact statement, affected version/commit, reproduction steps that use synthetic identifiers, and a suggested mitigation. Do not include live credentials or private captures.

## Deployment assumptions

- The dashboard is unauthenticated and defaults to loopback. Operators may explicitly enable trusted-LAN access with STATUS_BIND_IP or use an authenticated reverse proxy. Do not expose it to the Internet.
- The pinned Apache/OpenSSL compatibility image is intentionally old. Its TLS port must be reachable only from the isolated heater network and never from the public Internet.
- The heater should be placed on an isolated network with explicit egress blocking.
- The generated private key stays local and must never be committed.
- A DHCP reservation should prevent another client from inheriting the heater address targeted by firewall rules.
- This software is not a safety controller. Physical appliance controls and built-in safety systems remain authoritative.

## Supported versions

This project is pre-release. Security fixes will target the latest `main` branch until versioned releases are established.
