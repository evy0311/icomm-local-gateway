import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Controller } from '../src/controller.mjs';
import { createHeaterServer } from '../src/http.mjs';
import { getProfile } from '../src/devices/index.mjs';
import { sample } from './helpers.mjs';

test('real HTTP flow delivers only to the learned device and confirms by telemetry', async () => {
  const state = { instance: 'synthetic', vacationDays: 7 };
  const controller = new Controller({ state, save: async () => {}, profile: getProfile('reselec3'), readOnly: false });
  let tail = Promise.resolve();
  const run = (task) => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
  const server = createHeaterServer(controller, run, () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = '/devices/123';
  const report = (temperature) => fetch(`${base}${path}/properties/superBlockDyn1/datapoints.xml`,
    { method: 'POST', body: `<datapoint><value>${sample(temperature)}</value></datapoint>` });
  try {
    assert.equal((await report(120)).status, 200);
    await run(() => controller.command('temperature', 121));
    assert.equal((await fetch(`${base}/devices/456/commands.xml`)).status, 400);
    assert.equal(state.pending.status, 'queued');
    await fetch(`${base}${path}/properties/setBlockParameter/datapoints.xml`, { method: 'POST', body: '' });
    assert.equal(state.pending.status, 'queued');
    const delivered = await fetch(`${base}${path}/commands.xml?polling=1`);
    assert.match(await delivered.text(), /<name>setBlockParameter<\/name>/);
    assert.ok(!(await (await fetch(`${base}${path}/commands.xml`)).text()).includes('<property>'));
    const receipt = await fetch(`${base}${path}/properties/setBlockParameter/datapoints.xml`, { method: 'POST', body: '<datapoint><value></value></datapoint>' });
    assert.equal(receipt.status, 200);
    assert.equal(state.pending.status, 'acknowledged');
    assert.equal(state.lastCommand, undefined);
    assert.equal((await fetch(base + '/ping')).headers.get('content-type'), 'application/json');
    assert.equal((await report(121)).status, 200);
    assert.equal(state.lastCommand.status, 'confirmed');
    assert.equal((await fetch(`${base}/unrelated`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('local mode records unknown bootstrap routes and exact command/report exchanges', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Journal } = await import('../src/journal.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'icomm-local-http-'));
  const journal = await Journal.open(dir, { captureMode: 'full' });
  const controller = new Controller({ state: { instance: 'synthetic', vacationDays: 7 },
    save: async () => {}, profile: getProfile('reselec3'), readOnly: false });
  const server = createHeaterServer(controller, (task) => task(), () => {}, { journal });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const rejected = await fetch(base + '/dsns/SYNTHETIC.xml?fixture=1', {
      method: 'PUT', headers: { Authorization: 'synthetic-secret' }, body: 'synthetic-bootstrap' });
    assert.equal(rejected.status, 404);
    const payload = `<datapoint><value>${sample(120)}</value></datapoint>`;
    assert.equal((await fetch(base + '/devices/123/properties/superBlockDyn1/datapoints.xml', {
      method: 'POST', body: payload })).status, 200);
    await controller.command('temperature', 121);
    const command = await fetch(base + '/devices/123/commands.xml');
    const commandBody = await command.text();
    assert.match(commandBody, /setBlockParameter/);
    await journal.flush();
    const events = await journal.recent();
    const request = events.find(e => e.type === 'http.request' && e.method === 'PUT');
    assert.equal(request.url, '/dsns/SYNTHETIC.xml?fixture=1');
    assert.ok(request.headers.includes('synthetic-secret'));
    assert.equal(await readFile(join(dir, request.body.file), 'utf8'), 'synthetic-bootstrap');
    const response = events.find(e => e.type === 'http.response' && e.exchange === request.exchange);
    assert.equal(response.status, 404); assert.equal(response.origin, 'local');
    assert.equal((await readFile(join(dir, response.body.file))).length, 0);
    const recordedCommand = events.filter(e => e.type === 'http.response').at(-1);
    assert.equal(await readFile(join(dir, recordedCommand.body.file), 'utf8'), commandBody);
    assert.equal(journal.status().capture_errors, 0);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true });
  }
});

test('capture storage failure does not stop a local heater response', async () => {
  const journal = { captureMode: 'full', captureErrors: 0, record() {},
    captureRequest: async () => { throw new Error('disk unavailable'); },
    captureLocalReply: async () => { throw new Error('disk unavailable'); } };
  const controller = new Controller({ state: { instance: 'synthetic', vacationDays: 7 },
    save: async () => {}, profile: getProfile('reselec3'), readOnly: true });
  const server = createHeaterServer(controller, (task) => task(), () => {}, { journal });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/ping`)).status, 200);
    assert.equal(journal.captureErrors, 2);
    assert.equal(journal.lastError, 'Local HTTP capture failed');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test('local responses match observed Ayla1.0 token echo and XML content type', async () => {
  const controller = new Controller({ state: { instance: 'synthetic', vacationDays: 7 },
    save: async () => {}, profile: getProfile('reselec3'), readOnly: true });
  const server = createHeaterServer(controller, task => task(), () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const token = 'A'.repeat(36);
    const reply = await fetch(base + '/devices/123/commands.xml', { headers: { 'x-ayla-auth-key': 'Ayla1.0 ' + token } });
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get('x-ayla-auth-key'), token);
    assert.equal(reply.headers.get('content-type'), 'application/xml; charset=utf-8');
    const invalid = await fetch(base + '/ping', { headers: { 'x-ayla-auth-key': 'unknown arbitrary-token' } });
    assert.equal(invalid.headers.get('x-ayla-auth-key'), null);
    const missing = await fetch(base + '/ping');
    assert.equal(missing.headers.get('x-ayla-auth-key'), null);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
