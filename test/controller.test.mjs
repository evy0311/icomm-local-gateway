import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/controller.mjs';
import { getProfile } from '../src/devices/index.mjs';
import { loadStore } from '../src/store.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sample } from './helpers.mjs';

function setup(options = {}) {
  let clock = 100000;
  const state = { instance: 'synthetic', deviceId: null, pending: null, lastCommand: null, vacationDays: 7 };
  const controller = new Controller({ state, profile: getProfile('reselec3'), save: async () => {},
    readOnly: false, now: () => clock, ...options });
  return { controller, state, advance: (ms) => { clock += ms; } };
}

test('commands require fresh compatible telemetry; read-only cannot control', async () => {
  const { controller: c } = setup();
  await assert.rejects(c.command('temperature', 120), /fresh/);
  await c.telemetry(sample());
  c.readOnly = true;
  await assert.rejects(c.command('temperature', 121), /disabled/);
  assert.equal(await c.deliver(), null);
});

test('queued -> delivered -> acknowledged -> confirmed, with fresh state only', async () => {
  const { controller: c, state } = setup();
  await c.telemetry(sample(120));
  await c.command('temperature', 121);
  await c.telemetry(sample(121));
  assert.equal(state.pending.status, 'queued');
  const frame = await c.deliver();
  assert.equal(state.pending.status, 'delivered');
  assert.equal(await c.deliver(), null, 'never redeliver');
  await c.acknowledge('not the command');
  assert.equal(state.pending.status, 'delivered');
  await c.acknowledge(frame);
  assert.equal(state.pending.status, 'acknowledged');
  await c.telemetry(sample(120));
  assert.equal(state.pending.status, 'acknowledged');
  await c.telemetry(sample(121));
  assert.equal(state.pending, null);
  assert.equal(state.lastCommand.status, 'confirmed');
});

test('invalid values and duplicate commands are rejected', async () => {
  const { controller: c } = setup();
  await c.telemetry(sample());
  for (const value of [94, 131, NaN, 120.5]) await assert.rejects(c.command('temperature', value));
  for (const value of [0, 100, 1.5]) await assert.rejects(c.command('vacation_days', value));
  await assert.rejects(c.command('mode', 'OFF'));
  await c.command('temperature', 121);
  await assert.rejects(c.command('mode', 'STANDARD'), /pending/);
});

test('vacation duration stages without changing Standard mode, then applies with Vacation', async () => {
  const { controller: c, state } = setup();
  await c.telemetry(sample());
  await c.command('vacation_days', 3);
  assert.equal(state.pending, null);
  assert.equal(state.latest.mode, 'STANDARD');
  await c.command('mode', 'VACATION');
  assert.deepEqual(state.pending.target, { mode: 'VACATION', vacation_days: 3 });
  await c.deliver();
  await c.telemetry(sample(50, 2, 3));
  assert.equal(state.lastCommand.status, 'confirmed');
  await c.command('vacation_days', 4);
  assert.deepEqual(state.pending.target, { mode: 'VACATION', vacation_days: 4 });
});

test('stale or malformed telemetry removes availability and prevents delivery', async () => {
  const { controller: c, advance } = setup();
  await c.telemetry(sample());
  await c.command('temperature', 121);
  advance(900001);
  assert.equal(c.available, false);
  assert.equal(await c.deliver(), null);
  assert.equal(c.state.lastCommand.status, 'timed_out');
  await c.telemetry(sample());
  await assert.rejects(c.telemetry('malformed'));
  assert.equal(c.available, false);
  await assert.rejects(c.command('temperature', 121));
});

test('unknown modes fail closed', async () => {
  const { controller: c } = setup();
  await assert.rejects(c.telemetry(sample(120, 7)));
  assert.equal(c.available, false);
  assert.throws(() => getProfile('unknown'));
});

test('second device cannot receive or overwrite first device state', async () => {
  const { controller: c, state } = setup();
  await c.identify('123');
  await assert.rejects(c.identify('456'), /Different device/);
  assert.equal(state.deviceId, '123');
});

test('only an undelivered command can be canceled', async () => {
  const { controller: c, state } = setup();
  await c.telemetry(sample());
  await c.command('temperature', 121);
  await c.cancelQueued();
  assert.equal(state.lastCommand.status, 'canceled');
  await c.command('temperature', 122);
  await c.deliver();
  await assert.rejects(c.cancelQueued(), /undelivered/);
});

test('restart preserves identity and settings but interrupts pending commands', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icomm-test-'));
  try {
    const path = join(dir, 'state.json');
    const first = await loadStore(path);
    first.state.pending = { status: 'delivered', target: { temperature: 121 } };
    first.state.deviceId = '123';
    first.state.vacationDays = 9;
    await first.save();
    const second = await loadStore(path);
    assert.equal(second.state.instance, first.state.instance);
    assert.equal(second.state.deviceId, '123');
    assert.equal(second.state.vacationDays, 9);
    assert.equal(second.state.pending, null);
    assert.equal(second.state.lastCommand.status, 'interrupted');
    assert.equal(new Controller({ ...second, profile: getProfile('reselec3') }).available, false);
    const disk = JSON.parse(await readFile(path));
    assert.equal(disk.lastCommand.status, 'interrupted');
    await writeFile(path, 'invalid json');
    await assert.rejects(loadStore(path));
  } finally { await rm(dir, { recursive: true }); }
});

test('public state excludes private device ID and raw frames', async () => {
  const { controller: c } = setup();
  await c.identify('123');
  await c.telemetry(sample());
  await c.command('temperature', 121);
  const publicState = JSON.stringify(c.publicState());
  assert.ok(!publicState.includes('deviceId'));
  assert.ok(!publicState.includes('frame'));
  assert.ok(!publicState.includes('superBlock'));
});


test('explicit diagnostic temperature command can use stale state without declaring it fresh', async () => {
  const { controller: c, state, advance } = setup();
  await c.identify('123'); await c.telemetry(sample(129)); advance(900001);
  assert.equal(c.available, false);
  await c.command('temperature', 130, { allowStale: true });
  assert.equal(c.available, false); assert.equal(state.latest.temperature, 129);
  assert.equal(state.pending.diagnosticStaleState, true);
  assert.equal(await c.deliver(), c.profile.encode('temperature', 130).frame);
  assert.equal(await c.deliver(), null);
  assert.equal(state.pending.status, 'delivered');
  await c.telemetry(sample(130)); assert.equal(state.lastCommand.status, 'confirmed');
});

test('diagnostic command preserves identity, range, read-only and timeout checks', async () => {
  const { controller: c, state, advance } = setup();
  await assert.rejects(c.command('temperature', 130, { allowStale: true }), /known local/);
  await c.identify('123'); await c.telemetry(sample(129)); advance(900001);
  await assert.rejects(c.command('temperature', 131, { allowStale: true }));
  await assert.rejects(c.command('mode', 'VACATION', { allowStale: true }), /known local/);
  c.readOnly = true;
  await assert.rejects(c.command('temperature', 130, { allowStale: true }), /disabled/);
  c.readOnly = false;
  await c.command('temperature', 130, { allowStale: true }); advance(900001);
  assert.equal(await c.deliver(), null); assert.equal(state.lastCommand.status, 'timed_out');
});

 test('known local heater accepts bounded temperature updates while telemetry is stale', async () => {
 const {controller:c,state,advance}=setup();await c.identify('123');await c.telemetry(sample(129));advance(900001);
 assert.equal(c.canSetTemperature,true);assert.equal(c.available,false);
 await assert.rejects(c.command('temperature',131));await assert.rejects(c.command('mode','VACATION'),/fresh/);
 await c.command('temperature',130);assert.equal(state.latest.temperature,129);assert.equal(c.available,false);
 assert.equal(state.pending.temperatureWithoutFreshTelemetry,true);assert.ok(await c.deliver());assert.equal(await c.deliver(),null);
 await c.telemetry(sample(130));assert.equal(state.lastCommand.status,'confirmed');
 });
 test('stale temperature commands remain blocked for unknown, invalid, read-only and bridge states', async () => {
 const {controller:c,advance}=setup();await c.telemetry(sample(129));advance(900001);assert.equal(c.canSetTemperature,false);
 await c.identify('123');assert.equal(c.canSetTemperature,true);c.readOnly=true;assert.equal(c.canSetTemperature,false);
 c.readOnly=false;c.gatewayMode='bridge';assert.equal(c.canSetTemperature,false);c.gatewayMode='local';
 await assert.rejects(c.telemetry('bad'));assert.equal(c.canSetTemperature,false);
 await assert.rejects(c.command('temperature',130),/fresh/);
 });
