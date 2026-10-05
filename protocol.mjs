const SETPOINT_PREFIX = [0xbd, 0x40, 0x08, 0x0b, 0x06];
const MODE_PREFIX = [0xbd, 0x40, 0x08, 0x0b, 0x0f];

export function crc8F1(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0xf1) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function fahrenheitToFixedCelsius(fahrenheit) {
  return Math.round(((fahrenheit - 32) * 5 / 9) * 256);
}

export function encodeSetpointCommand(fahrenheit) {
  if (!Number.isInteger(fahrenheit) || fahrenheit < 95 || fahrenheit > 130) {
    throw new RangeError("Setpoint must be a whole number from 95 to 130°F");
  }
  const raw = fahrenheitToFixedCelsius(fahrenheit);
  const bytes = [...SETPOINT_PREFIX, raw >> 8, raw & 0xff];
  bytes.push(crc8F1(bytes));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function encodeVacationCommand(days) {
  if (!Number.isInteger(days) || days < 1 || days > 99) {
    throw new RangeError("Vacation duration must be a whole number from 1 to 99 days");
  }
  const bytes = [...MODE_PREFIX, days, 0x02];
  bytes.push(crc8F1(bytes));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function encodeStandardCommand() {
  // This exact vendor frame was captured twice and successfully restored
  // STANDARD mode. Its trailing byte does not match the otherwise-observed
  // CRC-8/F1 rule, so preserve the known-good frame verbatim.
  return "BD 40 08 0B 0F 00 01 6C";
}

export function emptyCommandsXml() {
  return "<commands>\n  <properties/>\n  <schedules/>\n  <cmds/>\n</commands>\n";
}

export function propertyCommandXml(name, value) {
  return `<commands>\n  <properties>\n    <property>\n      <base-type>string</base-type>\n      <mime-type></mime-type>\n      <name>${name}</name>\n      <value>${value}</value>\n    </property>\n  </properties>\n  <schedules/>\n  <cmds/>\n</commands>\n`;
}
