import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateHotWater } from '../src/hot-water-estimate.mjs';
import profile from '../src/devices/reselec3.mjs';
import { discovery } from '../src/discovery.mjs';
import { sample } from './helpers.mjs';

const rawF = f => (f - 32) * 5 / 9 * 256;
test('three-bar baseline is explicitly provisional and exposes its inputs, not a percentage', () => {
  const parts = sample(130).split(',');
  const temperatures = Buffer.from(parts[1], 'hex');
  temperatures.writeUInt16BE(12089, 2); parts[1] = temperatures.toString('hex');
  const decoded = profile.decode(parts.join(','));
  const result = decoded.hot_water_estimate;
  assert.equal(decoded.temperature, 130);
  assert.equal(result.bars, 3); assert.equal(result.level, 'High');
  assert.equal(result.candidate_fahrenheit, 117);
  assert.equal(result.deficit_fahrenheit, 13);
  assert.equal(result.provisional, true); assert.equal(result.confidence, 'low');
  assert.equal(result.percentage, undefined);
  assert.equal(decoded.current_temperature, undefined);
});
test('assumed thresholds distinguish all three bars without changing confirmed fields', () => {
  // Use integer fixed-point words around the boundaries, without decimal rounding deciding the bin.
  for (const [deficit, expected] of [[0,3],[14.9,3],[15.1,2],[29.9,2],[30.1,1],[60,1]]) {
    assert.equal(estimateHotWater(Math.round(rawF(130 - deficit)), 130, 'STANDARD').bars, expected);
  }
  // Exact boundaries using exactly representable Fahrenheit values.
  assert.equal(estimateHotWater(10240, 119, 'STANDARD').bars, 3); // 104°F + 15°F
  assert.equal(estimateHotWater(10240, 130, 'STANDARD').bars, 2);
  assert.equal(estimateHotWater(8960, 125, 'STANDARD').bars, 2); // 95°F + 30°F
});
test('invalid, missing, vacation, or implausible readings stay unknown', () => {
  for (const raw of [undefined, null, 0, 65535, -1, 2.5, 60000]) {
    assert.equal(estimateHotWater(raw, 130, 'STANDARD').bars, null);
  }
  assert.equal(estimateHotWater(12089, 130, 'VACATION').bars, null);
  assert.equal(estimateHotWater(12089, NaN, 'STANDARD').bars, null);
  assert.equal(profile.decode(sample()).hot_water_estimate.bars, null);
});
test('HA estimate has fresh-telemetry availability and publishes provisional attributes', () => {
  const config = discovery({instance:'test',name:'Test',profile})
    .find(row => row.payload.unique_id === 'icomm_test_hot_water_estimate').payload;
  assert.equal(config.unit_of_measurement, 'bars');
  assert.equal(config.command_topic, undefined);
  assert.deepEqual(config.availability, [{topic:'icomm/test/gateway'},{topic:'icomm/test/heater'}]);
  assert.match(config.json_attributes_template, /hot_water_estimate/);
  assert.match(config.value_template, /default\(none\)/);
});
