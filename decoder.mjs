const EXPECTED_PART_BYTES = [8, 140, 230, 52, 52];

function readU16BE(buffer, offset) {
  if (offset + 2 > buffer.length) return undefined;
  return buffer.readUInt16BE(offset);
}

function fixedCelsius(raw) {
  return raw === undefined ? undefined : raw / 256;
}

function fahrenheit(celsius) {
  return celsius === undefined ? undefined : celsius * 9 / 5 + 32;
}

function round(value, digits = 2) {
  return value === undefined ? undefined : Number(value.toFixed(digits));
}

export function decodeSuperBlock(value) {
  if (typeof value !== "string") throw new Error("superBlockDyn1 must be a string");
  const hexParts = value.split(",");
  if (hexParts.length !== EXPECTED_PART_BYTES.length) {
    throw new Error(`Expected 5 superBlockDyn1 segments, received ${hexParts.length}`);
  }
  if (hexParts.some((part) => !/^[0-9a-f]+$/i.test(part) || part.length % 2)) {
    throw new Error("superBlockDyn1 contains malformed hexadecimal data");
  }

  const parts = hexParts.map((part) => Buffer.from(part, "hex"));
  const lengths = parts.map((part) => part.length);
  if (lengths.some((length, index) => length !== EXPECTED_PART_BYTES[index])) {
    throw new Error(`Unexpected segment lengths: ${lengths.join(",")}`);
  }

  const activeRaw = readU16BE(parts[3], 0);
  const activeC = fixedCelsius(activeRaw);
  const modeCode = parts[3][31];

  const temperatureCandidates = [80, 84, 86, 112, 114].map((offset) => {
    const raw = readU16BE(parts[1], offset);
    const celsius = fixedCelsius(raw);
    return {
      segment: 2,
      offset,
      raw,
      celsius: round(celsius),
      fahrenheit: round(fahrenheit(celsius)),
    };
  });

  return {
    format: "superBlockDyn1-v1-observed",
    segmentBytes: lengths,
    setpoint: {
      raw: activeRaw,
      celsius: round(activeC, 3),
      fahrenheit: round(fahrenheit(activeC), 1),
    },
    mode: {
      code: modeCode,
      name: ({ 1: "STANDARD", 2: "VACATION" })[modeCode] || `UNKNOWN_${modeCode}`,
      vacationDays: parts[3][30],
    },
    temperatureCandidates,
    decodedConfidence: {
      setpoint: "confirmed",
      mode: "confirmed",
      vacationDays: "confirmed",
      temperatureCandidates: "unlabeled",
      hotWaterLevel: "unknown",
      energyUsage: "unknown",
    },
    raw: value,
  };
}

export function extractDatapoint(xml) {
  if (typeof xml !== "string") return undefined;
  return xml.match(/<datapoint>\s*<value>([^<]+)<\/value>\s*<\/datapoint>/i)?.[1];
}
