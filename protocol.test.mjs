import test from "node:test";
import assert from "node:assert/strict";
import {
  crc8F1,
  encodeSetpointCommand,
  encodeStandardCommand,
  encodeVacationCommand,
  fahrenheitToFixedCelsius,
} from "./protocol.mjs";

test("encodes all three observed setpoint command frames", () => {
  assert.equal(encodeSetpointCommand(128), "BD 40 08 0B 06 35 55 76");
  assert.equal(encodeSetpointCommand(129), "BD 40 08 0B 06 35 E4 38");
  assert.equal(encodeSetpointCommand(130), "BD 40 08 0B 06 36 72 34");
});

test("converts Fahrenheit to the observed fixed-point Celsius representation", () => {
  assert.equal(fahrenheitToFixedCelsius(128), 0x3555);
  assert.equal(fahrenheitToFixedCelsius(129), 0x35e4);
  assert.equal(fahrenheitToFixedCelsius(130), 0x3672);
});

test("CRC covers the seven command bytes", () => {
  assert.equal(crc8F1([0xbd, 0x40, 0x08, 0x0b, 0x06, 0x35, 0x55]), 0x76);
});

test("rejects temperatures outside the initially verified safe range", () => {
  assert.throws(() => encodeSetpointCommand(94), RangeError);
  assert.throws(() => encodeSetpointCommand(131), RangeError);
  assert.throws(() => encodeSetpointCommand(129.5), RangeError);
});

test("encodes both observed vacation command frames", () => {
  assert.equal(encodeVacationCommand(3), "BD 40 08 0B 0F 03 02 66");
  assert.equal(encodeVacationCommand(7), "BD 40 08 0B 0F 07 02 92");
});

test("uses the exact twice-observed STANDARD command frame", () => {
  assert.equal(encodeStandardCommand(), "BD 40 08 0B 0F 00 01 6C");
});

test("rejects invalid vacation durations", () => {
  assert.throws(() => encodeVacationCommand(0), RangeError);
  assert.throws(() => encodeVacationCommand(100), RangeError);
  assert.throws(() => encodeVacationCommand(3.5), RangeError);
});
