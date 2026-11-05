import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { XMLParser } from 'fast-xml-parser';
import { LocalDeviceService } from '../src/local-service.mjs';
import { Controller } from '../src/controller.mjs';
import { createHeaterServer } from '../src/http.mjs';
import { getProfile } from '../src/devices/index.mjs';
import { sample } from './helpers.mjs';
const parser = new XMLParser({ parseTagValue: false });
const controller = (state = { instance: 'synthetic', vacationDays: 7 }) => new Controller({
  state, save: async () => {}, profile: getProfile('reselec3'), readOnly: true });

test('fresh local enrollment needs no captured cloud credentials and survives restart', async () => {
  const c = controller(); const local = new LocalDeviceService(c, { now: () => 1700000000000 });
  const first = parser.parse(await local.lookup('SYNTHETIC-DSN')).device;
  assert.match(first.key, /^\d+$/);
  assert.equal(Buffer.from(first['ans-cipher-key'], 'base64').length, 64);
  assert.equal(first['unix-time'], '1700000000');
  assert.equal(first.model, 'AY001MTL1');
  const next = new LocalDeviceService(controller(JSON.parse(JSON.stringify(c.state))));
  const second = parser.parse(await next.lookup('SYNTHETIC-DSN')).device;
  for (const key of ['key', 'ans-cipher-key', 'regtoken', 'setup-token']) assert.equal(second[key], first[key]);
  await assert.rejects(next.lookup('OTHER-DSN'), /Different device/);
  await assert.rejects(next.lookup('<invalid>'), /Invalid DSN/);
  assert.ok(!JSON.stringify(c.publicState()).includes(first['ans-cipher-key']));
  assert.ok(!JSON.stringify(c.publicState()).includes('SYNTHETIC-DSN'));
});

test('migration keeps the learned device ID and reporting configuration resets on lookup', async () => {
  const c = controller({ instance: 'synthetic', vacationDays: 7, deviceId: '123' });
  const local = new LocalDeviceService(c, { configureReporting: true });
  assert.equal(parser.parse(await local.lookup('SYNTHETIC')).device.key, '123');
  const value = local.takeReportingConfiguration();
  assert.equal(value.length, 233); assert.deepEqual(value.split(',').map(x => x.length), [73,105,26,26]);
  assert.equal(local.takeReportingConfiguration(), null);
  await local.lookup('SYNTHETIC'); assert.equal(local.takeReportingConfiguration(), value);
  assert.equal(await local.oemInfo('123', '{"template_version":""}'), '{}');
  await assert.rejects(local.oemInfo('456', '{}'), /Different device/);
  await assert.rejects(local.oemInfo('123', '[]'), /Invalid OEM/);
});

test('local startup reaches reporting without contacting a cloud service', async () => {
  const c = controller(); const localService = new LocalDeviceService(c);
  const server = createHeaterServer(c, task => task(), () => {}, { localService });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lookup = await fetch(base + '/dsns/SYNTHETIC.xml'); assert.equal(lookup.status, 200);
    const id = parser.parse(await lookup.text()).device.key;
    assert.equal((await fetch(base + `/devices/${id}/oem_info.json`, {
      method: 'PUT', body: '{"template_version":""}' })).status, 200);
    assert.equal((await fetch(base + `/devices/${id}.xml`, { method: 'PUT',
      body: '<device><sw-version>synthetic</sw-version><lan-ip>192.0.2.7</lan-ip><ssid>fixture</ssid></device>' })).status, 200);
    const first = await (await fetch(base + `/devices/${id}/commands.xml`)).text();
    assert.ok(!first.includes('<property>'), 'default matches original command-only handler');
    assert.ok(!(await (await fetch(base + `/devices/${id}/commands.xml`)).text()).includes('<property>'));
    assert.equal((await fetch(base + `/devices/${id}/properties/superBlockDyn1/datapoints.xml`, {
      method: 'POST', body: `<datapoint><value>${sample(120)}</value></datapoint>` })).status, 200);
    assert.equal(c.available, true); assert.equal(c.publicState().temperature, 120);
    assert.equal((await fetch(base + '/unknown')).status, 404);
    assert.equal((await fetch(base + '/dsns/SYNTHETIC.xml', { method: 'POST' })).status, 405);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test('device metadata update persists private fields, reflects firmware and rejects identity changes', async () => {
  const c = controller(); const local = new LocalDeviceService(c);
  await local.lookup('SYNTHETIC'); const id = c.state.deviceId;
  const doc = parser.parse(await local.updateDevice(id,
    '<device><sw-version>synthetic-firmware</sw-version><lan-ip>192.0.2.7</lan-ip><ssid>synthetic-network</ssid></device>')).device;
  assert.equal(doc['sw-version'], 'synthetic-firmware');
  assert.equal(parser.parse(await local.lookup('SYNTHETIC')).device.ssid, 'synthetic-network');
  assert.ok(!JSON.stringify(c.publicState()).includes('synthetic-network'));
  await assert.rejects(local.updateDevice(String(Number(id) + 1), '<device/>'), /Different device/);
  await assert.rejects(local.updateDevice(id, '<device><key>other</key></device>'), /Unsupported/);
  await assert.rejects(local.updateDevice(id, '<!DOCTYPE x [<!ENTITY x "bad">]><device/>'), /Invalid/);
});


test('empty device metadata updates are no-ops after a matching lookup', async () => {
  const c = controller(); const local = new LocalDeviceService(c);
  await local.lookup('SYNTHETIC'); const id = c.state.deviceId;
  await local.updateDevice(id, '<device><sw-version>synthetic</sw-version></device>');
  for (const xml of ['<?xml version="1.0"?><device></device>', '<device/>']) {
    assert.equal(parser.parse(await local.updateDevice(id, xml)).device['sw-version'], 'synthetic');
  }
  await assert.rejects(local.updateDevice(id, '<other/>'), /Invalid device update/);
  await assert.rejects(local.updateDevice(id, '<device>arbitrary-text</device>'), /Invalid device update/);
});


test('startup keeps setup token empty and default command path free of injected subscriptions', async () => {
  const c = controller(); const local = new LocalDeviceService(c);
  const doc = parser.parse(await local.lookup('SYNTHETIC')).device;
  assert.equal(doc['setup-token'], ''); assert.equal(doc.regtoken.length, 6);
  assert.equal(local.takeReportingConfiguration(), null);
  c.state.localIdentity.setupToken = 'old-generated-token';
  c.state.localIdentity.registrationToken = 'a'.repeat(32);
  const migrated = parser.parse(await local.lookup('SYNTHETIC')).device;
  assert.equal(migrated['setup-token'], ''); assert.equal(migrated.regtoken.length, 6);
  assert.equal(c.state.localIdentity.setupToken, undefined);
});
