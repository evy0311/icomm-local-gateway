// Synthetic device only. Run against a NEW disposable, internal-network stack.
import assert from 'node:assert/strict';
import https from 'node:https';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { registration } from './ans-helpers.mjs';
import { ANS_TYPES, encodeAnsPacket, decodeAnsPacket } from '../src/ans-protocol.mjs';
import { XMLParser } from 'fast-xml-parser';
import { sample } from './helpers.mjs';
const statusPort = process.env.STATUS_PORT ?? '18789';
const tlsPort = process.env.HTTPS_PORT ?? '18443';
const tlsHost = process.env.TEST_TLS_HOST ?? '127.0.0.1';
const initial = await (await fetch(`http://127.0.0.1:${statusPort}/api/devices`)).json();
assert.equal(initial.gateway.mode, 'local');
assert.equal(initial.devices.length, 0, 'refuse synthetic enrollment on an existing device instance');
const state = await (await fetch(`http://127.0.0.1:${statusPort}/state`)).json();
const controls = process.env.TEST_COMMANDS_ENABLED === '1';
assert.equal(state.read_only, !controls);
assert.equal(state.received_at, undefined);
function request(path, method = 'GET', body = '') {
  return new Promise((resolve, reject) => {
    // Only the disposable fixture accepts the self-signed heater endpoint.
    const req = https.request({ hostname: tlsHost, port: tlsPort, path, method,
      rejectUnauthorized: false }, reply => {
      const chunks = []; reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => resolve({ status: reply.statusCode, body: Buffer.concat(chunks).toString() }));
      reply.on('error', reject);
    });
    req.on('error', reject); req.end(body);
  });
}
const lookup = await request('/dsns/SYNTHETIC-OFFLINE.xml');
assert.equal(lookup.status, 200);
const document = new XMLParser({ parseTagValue: false }).parse(lookup.body).device;
const id = document.key; assert.match(id, /^\d+$/);
const material = Buffer.from(document['ans-cipher-key'], 'base64');
assert.equal(material.length, 64);
const client = dgram.createSocket('udp4');
const exchange = async packet => {
  const reply = once(client, 'message', { signal: AbortSignal.timeout(3000) });
  client.send(packet, Number(process.env.ANS_PORT ?? 15555), process.env.TEST_ANS_HOST ?? '127.0.0.1');
  return decodeAnsPacket((await reply)[0], material);
};
try {
  const registered = await exchange(registration(material, 'SYNTHETIC-OFFLINE'));
  assert.equal(registered.type, ANS_TYPES.registered);
  const heartbeat = await exchange(encodeAnsPacket({ header: registered.header,
    type: ANS_TYPES.keepalive, sequence: 13, senderClock: 2000, argument: 30 }, material));
  assert.equal(heartbeat.type, ANS_TYPES.keepaliveReply);

assert.equal((await request(`/devices/${id}.xml`, 'PUT', '<device><sw-version>synthetic</sw-version><lan-ip>192.0.2.7</lan-ip><ssid>fixture</ssid></device>')).status, 200);
assert.equal((await request(`/devices/${id}/oem_info.json`, 'PUT', '{"template_version":""}')).status, 200);
assert.match((await request(`/devices/${id}/commands.xml`)).body, /<name>periodicParameterSetting<\/name>/);
assert.ok(!(await request(`/devices/${id}/commands.xml`)).body.includes('<property>'));
assert.equal((await request(`/devices/${id}/properties/superBlockDyn1/datapoints.xml`, 'POST',
  `<datapoint><value>${sample(120)}</value></datapoint>`)).status, 200);
const after = await (await fetch(`http://127.0.0.1:${statusPort}/state`)).json();
assert.equal(after.available, true); assert.equal(after.temperature, 120);
assert.equal(after.gateway_mode, 'local'); assert.equal(after.read_only, !controls);
assert.equal(after.bridge.ans.connected, true);
assert.equal(after.bridge.ans.registrations, 1);
assert.equal(after.bridge.ans.rejected, 0);
if (controls) {
  const settings = await (await fetch(`http://127.0.0.1:${statusPort}/api/settings`)).json();
  const devices = await (await fetch(`http://127.0.0.1:${statusPort}/api/devices`)).json();
  const noticeReceived = once(client, 'message', { signal: AbortSignal.timeout(3000) });
  const queued = await fetch(`http://127.0.0.1:${statusPort}/api/devices/${devices.devices[0].id}/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-iCOMM-Token': settings.csrf },
    body: JSON.stringify({ kind: 'temperature', value: 121 }) });
  assert.equal(queued.status, 202);
  const notice = decodeAnsPacket((await noticeReceived)[0], material);
  assert.equal(notice.type, ANS_TYPES.notify);
  client.send(encodeAnsPacket({ header: notice.header, type: ANS_TYPES.notifyReply,
    sequence: notice.sequence, senderClock: 3000, argument: 0 }, material),
    Number(process.env.ANS_PORT ?? 15555), process.env.TEST_ANS_HOST ?? '127.0.0.1');
  const command = await request(`/devices/${id}/commands.xml`);
  assert.match(command.body, /<name>setBlockParameter<\/name>/);
  assert.equal((await request(`/devices/${id}/properties/setBlockParameter/datapoints.xml`, 'POST', '<datapoint><value></value></datapoint>')).status, 200);
  const acknowledged = await (await fetch(`http://127.0.0.1:${statusPort}/state`)).json();
  assert.equal(acknowledged.command_status, 'acknowledged');
  assert.equal((await request(`/devices/${id}/properties/superBlockDyn1/datapoints.xml`, 'POST',
    `<datapoint><value>${sample(121)}</value></datapoint>`)).status, 200);
  const confirmed = await (await fetch(`http://127.0.0.1:${statusPort}/state`)).json();
  assert.equal(confirmed.command_status, 'confirmed'); assert.equal(confirmed.temperature, 121);
  console.log('PASS: local UDP notification -> TLS command fetch -> empty receipt -> confirming telemetry');
}
console.log('PASS: fresh local keys -> TLS enrollment -> authenticated UDP registration/keepalive -> telemetry, with no Internet access');
} finally { client.close(); }
