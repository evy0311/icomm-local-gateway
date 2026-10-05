# Architecture

## Traffic flow

```text
                         loopback only
                     +------------------+
                     | browser / API    |
                     | 127.0.0.1:8788   |
                     +--------+---------+
                              |
heater Wi-Fi                   v
+------------+        +------------------+       +----------------+
| iCOMM      | HTTPS  | Apache TLS front | HTTP  | local gateway  |
| module     +------->+ host :8443       +------>+ container :8080|
|            |        +------------------+       +----------------+
|            | DNS/53       | PF redirects       | state + decoder
|            +------------->+ host UDP :1053     | command queue
|            | ANS/55055    |                    |
|            +------------->+ host UDP :15555 ---+ local sink only
+------------+        +--------------------------+
      |
      +---- all other IPv4 traffic is dropped by the heater-scoped PF rule
```

The heater still asks for its normal cloud hostnames and destinations. The network redirects happen below the application layer, so no DNS or firmware setting needs to be changed on the module.

## Components

### Packet-filter rules

`scripts/configure.mjs` writes `pf-local-only.generated.conf` for one heater address and one macOS interface. It redirects:

| Original heater traffic | Local endpoint | Purpose |
|---|---|---|
| UDP destination port 53 | gateway UDP 1053 | Return the gateway address for IPv4 DNS questions |
| TCP destination port 443 | gateway TCP 8443 | Terminate the heater's HTTPS connection |
| UDP destination port 55055 | gateway UDP 15555 | Contain legacy Ayla notification traffic locally |

DHCP is allowed. Other IPv4 traffic from the configured heater address is dropped.

### TLS front end

The `httpd:2.4.57-bullseye` container uses Apache 2.4 and OpenSSL 1.1.1. This combination and an RSA self-signed CA-style certificate were accepted by the tested legacy module. Apache proxies decrypted HTTP to the gateway container and never contacts an upstream server.

The certificate is generated locally and ignored by Git. Its private key does not need to be installed on the heater or shared with anyone.

### Gateway service

The dependency-free Node service has three listeners:

- HTTP 8080 inside Docker for heater device-service traffic;
- UDP 5353 inside Docker for local DNS replies; and
- UDP 55055 inside Docker as a non-forwarding ANS sink.

Its separate administrative HTTP service listens on container port 8081 and is published to host loopback only.

### State and command lifecycle

State is stored in the `gateway-data` Docker volume. A local command moves through:

```text
queued -> delivered -> acknowledged -> confirmed
```

- `queued`: accepted by the local dashboard/API.
- `delivered`: returned to a heater `/commands.xml` request.
- `acknowledged`: the heater posted the command property back.
- `confirmed`: a later telemetry block matches the requested value.

Confirmation from telemetry matters because an HTTP 200 alone proves only message delivery, not that the physical controller applied the change.

## Trust boundaries

- The dashboard/API has no authentication and is intentionally bound to `127.0.0.1`.
- The TLS listener and UDP listeners must be reachable from the heater network.
- The generated PF rule trusts a stable heater IPv4 address. Reserve that address in DHCP so it cannot be assigned to another client.
- The gateway does not need A. O. Smith credentials.
- The published code contains no upstream relay. Internet isolation is enforced by the network rule, not merely by application intent.

## Current limitation: command latency

The tested firmware uses an authenticated, stateful UDP notification service for immediate cloud commands. Replaying old notification datagrams did not work. With that service contained locally, the heater falls back to an HTTPS command poll roughly every five minutes. The gateway relies on that proven fallback.

A future fast-wake implementation must be derived without embedding per-device secrets, relaying to Ayla, or weakening the local-only guarantee.
