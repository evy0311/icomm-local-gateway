# Detailed macOS setup

This guide expands the quick start. It assumes the Mac receives Internet over Ethernet and shares a Wi-Fi network to the heater. Adapt the topology if your Mac uses different interfaces.

## 1. Record a recovery path

Before changing anything:

- note the heater's existing Wi-Fi name;
- confirm you can operate the heater from its physical controls;
- record the normal setpoint and operating mode; and
- know how to disable and re-enable the heater's Wi-Fi from its control panel.

Do not begin while the appliance displays a fault or is being serviced.

## 2. Enable Internet Sharing

In **System Settings → General → Sharing → Internet Sharing**:

1. Share the Ethernet/USB-Ethernet connection.
2. Share it to **Wi-Fi**.
3. Choose a test SSID and WPA2/WPA3 password.
4. Turn Internet Sharing on.

The precise interface names depend on the adapter. To identify them:

```sh
networksetup -listallhardwareports
ifconfig bridge100
```

On the tested Mac, the shared network used `bridge100` and the Mac was `192.168.2.1`. An iPhone joining the shared SSID received `192.168.2.2`, which confirmed DHCP was working. A `169.254.x.x` address means DHCP failed; restart Internet Sharing or the Mac before proceeding.

## 3. Join the heater and find its address

Use the heater/app pairing flow to join the test SSID. Then inspect:

```sh
arp -a
```

Compare the output with heater Wi-Fi disabled and enabled. A DHCP reservation is strongly recommended so the generated firewall rule continues to identify the same appliance.

Avoid fast full-subnet port scans. Some consumer access points and embedded devices behave poorly under aggressive scanning.

## 4. Prepare the repository

```sh
./scripts/generate-cert.sh
node scripts/configure.mjs
```

Example answers:

```text
Heater IPv4 address [192.168.2.3]:
Gateway IPv4 address on the heater network [192.168.2.1]:
macOS Internet Sharing interface [bridge100]:
```

The generated `.env` controls Docker's local ports. `pf-local-only.generated.conf` contains the exact heater, gateway, and interface values. Both are ignored by Git.

## 5. Review the firewall rule

Open the generated file and verify every address and interface. The three `rdr` lines should target only the heater address. The final rule should drop other IPv4 traffic from that same address.

Start the containers before loading the redirects:

```sh
docker compose up -d --build
docker compose ps
```

Load the dedicated anchor:

```sh
sudo pfctl -a com.apple/icomm-local-gateway -f ./pf-local-only.generated.conf
sudo pfctl -a com.apple/icomm-local-gateway -s nat
sudo pfctl -a com.apple/icomm-local-gateway -s rules
sudo pfctl -k HEATER_IP
```

The NAT view should list DNS, ANS, and HTTPS redirects. The rules view should show DHCP allowance and the heater-specific block.

## 6. Observe first contact

```sh
docker compose logs -f
```

Normal startup messages include:

```text
Local DNS listening on UDP 5353
Local ANS sink listening on UDP 55055; outbound relay is disabled
Heater gateway listening on 8080
Local API listening on 8081
```

The heater may need its Wi-Fi toggled once. A successful session includes a DNS lookup, an HTTPS request, and decoded telemetry. The numeric device ID is learned automatically and never needs to be entered manually.

## 7. Prove the heater is isolated

In another terminal:

```sh
sudo tcpdump -i bridge100 -n -e 'host HEATER_IP'
```

Expected traffic includes local DNS replies, HTTPS redirected to the Mac, ANS retries redirected to the Mac, and DHCP. There should be no completed TCP/TLS session between the heater and a public IP.

The official iCOMM app showing the heater as disconnected is expected and is additional evidence—not sufficient by itself—that Ayla no longer sees the device.

## 8. Test read-only, then control

Open `http://localhost:8788`. Compare the displayed values with the physical panel. Do not send a command if they differ.

For the first command, change the setpoint by one degree within a safe range and remain near the heater. Wait up to six minutes. Confirm the new value on the physical panel and then return it if desired.

## 9. Recovery

Remove only this project's anchor and stop its containers:

```sh
sudo pfctl -a com.apple/icomm-local-gateway -F all
docker compose down
```

Do not flush the entire system PF ruleset. macOS Internet Sharing and other software may own unrelated rules.

If the official app remains offline, toggle heater Wi-Fi, verify the PF anchor is empty, and confirm the heater again receives working DNS and Internet access.
