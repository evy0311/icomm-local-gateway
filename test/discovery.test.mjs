import test from 'node:test';
import assert from 'node:assert/strict';
import { discovery } from '../src/discovery.mjs';
import { getProfile } from '../src/devices/index.mjs';

test('discovery groups entities, separates availability, and never retains commands', () => {
  const configs = discovery({ instance: 'synthetic', name: 'Test heater', profile: getProfile('reselec3') });
  assert.equal(configs.length, 18);
  assert.equal(new Set(configs.map((c) => c.payload.unique_id)).size, 18);
  for (const { payload } of configs) {
    assert.deepEqual(payload.device.identifiers, ['icomm_synthetic']);
    assert.equal(payload.availability_mode, 'all');
    if (payload.command_topic) {
      assert.equal(payload.retain, false);
      assert.equal(payload.qos, 0);
      assert.equal(payload.availability.length, (payload.unique_id.endsWith('_wake') || payload.unique_id.endsWith('_temperature')) ? 2 : 3);
    }
    assert.equal(payload.current_temperature_topic, undefined, 'actual tank temperature is not decoded');
  }
  const mode = configs.find((c) => c.topic.includes('/mode/config')).payload;
  assert.deepEqual(mode.options, ['STANDARD', 'VACATION']);
  const temperature = configs.find((c) => c.topic.includes('/temperature/config')).payload;
  assert.equal(temperature.min, 95);
  assert.equal(temperature.max, 130);
});

test('connection diagnostics and last report remain visible when heater telemetry is stale', () => {
  const configs = discovery({ instance: 'synthetic', name: 'Test heater', profile: getProfile('reselec3') });
  for (const id of ['last_seen', 'gateway_mode', 'heater_connected', 'ans_connected', 'read_only']) {
    const config = configs.find(c => c.payload.unique_id === `icomm_synthetic_${id}`).payload;
    assert.deepEqual(config.availability, [{topic: 'icomm/synthetic/gateway'}]);
    assert.equal(config.entity_category, 'diagnostic');
  }
  for (const id of ['heater_connected','ans_connected','read_only']) {
    const config = configs.find(c => c.payload.unique_id === `icomm_synthetic_${id}`).payload;
    assert.equal(config.payload_on, 'ON'); assert.equal(config.payload_off, 'OFF');
    assert.equal(config.command_topic, undefined);
  }
});
