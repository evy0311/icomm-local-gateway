import test from "node:test";
import assert from "node:assert/strict";
import { decodeSuperBlock } from "./decoder.mjs";

function sample(setpointHex, modeHex = "01", daysHex = "00") {
  const parts = [Buffer.alloc(8), Buffer.alloc(140), Buffer.alloc(230), Buffer.alloc(52), Buffer.alloc(52)];
  const raw = Number.parseInt(setpointHex, 16);
  for (const offset of [80, 84, 86, 112, 114]) parts[1].writeUInt16BE(raw, offset);
  parts[3].writeUInt16BE(raw, 0);
  parts[3][30] = Number.parseInt(daysHex, 16);
  parts[3][31] = Number.parseInt(modeHex, 16);
  return parts.map((part) => part.toString("hex")).join(",");
}

test("decodes observed fixed-point setpoints", () => {
  assert.equal(decodeSuperBlock(sample("3672")).setpoint.fahrenheit, 130);
  assert.equal(decodeSuperBlock(sample("35e4")).setpoint.fahrenheit, 129);
  assert.equal(decodeSuperBlock(sample("34c7")).setpoint.fahrenheit, 127);
});

test("decodes seven-day vacation mode", () => {
  const decoded = decodeSuperBlock(sample("0a00", "02", "07"));
  assert.equal(decoded.setpoint.fahrenheit, 50);
  assert.equal(decoded.mode.name, "VACATION");
  assert.equal(decoded.mode.vacationDays, 7);
});
