# Observed protocol notes

These observations come from authorized testing of an owned A. O. Smith iCOMM ResElec3 heater. They are not a complete Ayla protocol specification.

## Device-service exchange

The heater uploads dynamic state with:

```http
POST /devices/<device-id>/properties/superBlockDyn1/datapoints.xml
```

The XML `<value>` contains five comma-separated hexadecimal segments. The verified segment sizes are 8, 140, 230, 52, and 52 bytes.

The heater retrieves commands with:

```http
GET /devices/<device-id>/commands.xml?polling=1&signal=<rssi>
```

After receiving a property command, it reports the property through:

```http
POST /devices/<device-id>/properties/setBlockParameter/datapoints.xml
```

and uploads a new dynamic block.

## Confirmed dynamic fields

In the fourth segment (zero-based segment index 3):

- bytes 0–1: active setpoint, big-endian degrees Celsius multiplied by 256;
- byte 30: vacation duration in days; and
- byte 31: mode (`1` Standard, `2` Vacation).

Several other temperature-shaped values exist in the second segment, but their physical meaning is not established. The decoder reports them only as unlabeled candidates.

## Property command envelope

Commands are returned as an Ayla property update:

```xml
<commands>
  <properties>
    <property>
      <base-type>string</base-type>
      <mime-type></mime-type>
      <name>setBlockParameter</name>
      <value>FRAME BYTES</value>
    </property>
  </properties>
  <schedules/>
  <cmds/>
</commands>
```

Setpoint frames use a stable five-byte prefix, two-byte fixed-point Celsius value, and CRC-8/F1 over the first seven bytes. The implementation is covered by captured-vector tests. Vacation frames use the observed day and mode fields with the same CRC. Standard mode uses an exact repeatedly observed frame because its final byte does not match the otherwise observed CRC rule.

The repository intentionally documents the encoding algorithm while omitting device-specific IDs, DSNs, addresses, tokens, and authenticated notification packets.

## Notification service

The tested firmware also uses a legacy UDP service on destination port 55055 for immediate cloud notification. Its session is authenticated and stateful. Captured datagrams could not be replayed into a new session. The published gateway therefore treats this traffic as a local sink and relies on the heater's approximately five-minute HTTPS fallback poll.

No per-device secret, cloud credential, or outbound relay is included in this repository.
