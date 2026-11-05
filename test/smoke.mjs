// Run against a NEW disposable compose project only: this learns a synthetic device ID.
import assert from 'node:assert/strict';
import https from 'node:https';
import mqtt from 'mqtt';
import { sample } from './helpers.mjs';

const statusPort = process.env.STATUS_PORT ?? '18789';
const tlsPort = process.env.HTTPS_PORT ?? '18443';
const brokerPort = process.env.TEST_MQTT_PORT ?? '18885';
const initial = await (await fetch(`http://127.0.0.1:${statusPort}/state`)).json();
assert.equal(initial.read_only, true);
assert.equal(initial.gateway_mode, 'local', 'never send synthetic heater data through the real cloud bridge');
assert.equal(initial.received_at, undefined, 'refuse to inject synthetic data into an existing heater instance');
const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${brokerPort}`, { connectTimeout: 5000 });
const messages = new Map();
client.on('message', (topic, payload) => messages.set(topic, payload.toString()));
await client.subscribeAsync(['homeassistant/#', 'icomm/#']);
const until = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for MQTT');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
try {
  await until(() => [...messages.keys()].filter((t) => t.endsWith('/config')).length === 18);
  const body = `<datapoint><value>${sample(120)}</value></datapoint>`;
  // The device accepts the legacy self-signed certificate. Only this local fixture client skips validation.
  await new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port: tlsPort,
      path: '/devices/123/properties/superBlockDyn1/datapoints.xml', method: 'POST', rejectUnauthorized: false },
    (response) => { response.resume(); response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${response.statusCode}`))); });
    request.on('error', reject); request.end(body);
  });
  const stateTopic = [...messages.keys()].find((t) => t.endsWith('/state'));
  await until(() => JSON.parse(messages.get(stateTopic)).temperature === 120);
  const base = stateTopic.slice(0, -'/state'.length);
  await until(() => messages.get(`${base}/heater`) === 'online');
  assert.equal(messages.get(`${base}/controls`), 'offline');
  await client.publishAsync(`${base}/set/temperature`, '121', { retain: false });
  await until(() => /disabled/.test(JSON.parse(messages.get(stateTopic)).error ?? ''));
  const after = await (await fetch(`http://127.0.0.1:${statusPort}/state`)).json();
  assert.equal(after.temperature, 120);
  assert.equal(after.command_status, 'idle');
  console.log('PASS: 18 discovery entities, HTTPS -> decoded MQTT state, online/offline availability, read-only command rejection');
} finally { await client.endAsync(); }
