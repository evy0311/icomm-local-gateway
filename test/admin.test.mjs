import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../src/admin.mjs';
import { Controller } from '../src/controller.mjs';
import { getProfile } from '../src/devices/index.mjs';
import { loadSettings } from '../src/settings.mjs';

test('UI serves devices and saves real settings with request forgery protection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icomm-admin-'));
  const defaults = { mode: 'bridge', captureMode: 'full', cloudHost: 'synthetic-device.aylanetworks.com' };
  const path = join(directory, 'runtime.json');
  const settings = await loadSettings(path, defaults);
  const controller = new Controller({ state: { instance: '00000000-0000-4000-8000-000000000001', deviceId: '123' },
    save: async () => {}, profile: getProfile('reselec3'), gatewayMode: 'bridge' });
  let restarted = false;
  const server = createWebServer({ controller, settings, name: 'Synthetic heater', run: (task) => task(),
    restart: () => { restarted = true; }, mqttStatus: () => ({ connected: true, label: 'Test' }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + '/');
    assert.match(await page.text(), /iCOMM Gateway/);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const devices = await (await fetch(base + '/api/devices')).json();
    assert.equal(devices.devices.length, 1);
    assert.equal(devices.devices[0].name, 'Synthetic heater');
    assert.ok(!JSON.stringify(devices).includes('deviceId'));
    assert.equal(devices.devices[0].state.available, false);
    const body = JSON.stringify({ mode: 'local' });
    assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    const config = await (await fetch(base + '/api/settings')).json();
    const headers = { 'Content-Type': 'application/json', 'X-iCOMM-Token': config.csrf };
    assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body })).status, 403);
    assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers, body })).status, 202);
    assert.equal((await loadSettings(path, defaults)).current.mode, 'local');
    await new Promise((done) => setTimeout(done, 400));
    assert.equal(restarted, true);
    await assert.rejects(settings.save({ cloudHost: '127.0.0.1' }));
    await assert.rejects(settings.save({ unexpected: 'value' }));
    await settings.reset();
    assert.equal((await loadSettings(path, defaults)).current.mode, 'bridge');
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(directory, { recursive: true }); }
});
