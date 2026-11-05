import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal.mjs';
import { sample } from './helpers.mjs';
import { Readable } from 'node:stream';

test('structured trace removes credentials and identity but keeps useful protocol fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icomm-journal-'));
  try {
    const journal = await Journal.open(dir);
    const json = Buffer.from(JSON.stringify({ device: { id: 987654321, dsn: 'PRIVATE-DSN',
      lan_key: 'LAN-SECRET', password: 'PRIVATE-PASSWORD', model: 'ResElec3',
      connection_status: 'connected', unknown_field: 'PRIVATE-UNKNOWN', enabled: true } }));
    const document = journal.body(json, 'application/json');
    const route = journal.route('/devices/987654321/commands.xml?token=PRIVATE-QUERY');
    journal.record('http.request', { exchange: 'synthetic', ...route, body: document });
    await journal.flush();
    const raw = await readFile(join(dir, 'bridge-00000001.jsonl'), 'utf8');
    for (const secret of ['987654321', 'PRIVATE-DSN', 'LAN-SECRET', 'PRIVATE-PASSWORD', 'PRIVATE-UNKNOWN', 'PRIVATE-QUERY']) {
      assert.ok(!raw.includes(secret), 'secret/identity must not be stored');
    }
    assert.match(raw, /ResElec3/);
    assert.match(raw, /commands.xml/);
    assert.match(raw, /connected/);
    assert.equal((await stat(join(dir, 'bridge-00000001.jsonl'))).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal(journal.status().written_this_session, 1);
  } finally { await rm(dir, { recursive: true }); }
});

test('XML command frames are recorded while authentication fields are redacted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icomm-journal-'));
  try {
    const journal = await Journal.open(dir);
    const xml = '<commands><properties><property><name>setBlockParameter</name><value>BD 40 08 0B 06 36 72 00</value></property></properties><token>PRIVATE-TOKEN</token></commands>';
    const capture = JSON.stringify(journal.body(Buffer.from(xml), 'application/xml'));
    assert.match(capture, /BD 40 08 0B 06 36 72 00/);
    assert.ok(!capture.includes('PRIVATE-TOKEN'));
    const telemetry = journal.body(Buffer.from(`<datapoint><value>${sample(130)}</value></datapoint>`), 'application/xml', 'superBlockDyn1');
    assert.equal(telemetry.document.datapoint.value.setpoint.fahrenheit, 130);
    assert.ok(!JSON.stringify(telemetry).includes(sample(130)));
    const dtd = journal.body(Buffer.from('<!DOCTYPE x [<!ENTITY s "PRIVATE-ENTITY">]><x>&s;</x>'), 'application/xml');
    assert.equal(dtd.omitted, 'unparseable content');
  } finally { await rm(dir, { recursive: true }); }
});

test('journal survives restart, keeps correlation tokens, and rotates without deleting events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icomm-journal-'));
  try {
    const first = await Journal.open(dir, { maxBytes: 250 });
    const token = first.fingerprint('synthetic-identity');
    for (let index = 0; index < 8; index++) first.record('fixture', { index });
    await first.flush();
    const second = await Journal.open(dir, { maxBytes: 250 });
    assert.equal(second.fingerprint('synthetic-identity'), token);
    second.record('fixture', { index: 8 }); await second.flush();
    const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort();
    assert.ok(files.length > 1);
    const rows = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8'))))
      .join('').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map((row) => row.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.notEqual(first.session, second.session);
    assert.equal(second.status().error, null);
  } finally { await rm(dir, { recursive: true }); }
});

test('opt-in full capture preserves exact headers, URLs, and binary bodies without the redacted size limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icomm-full-'));
  try {
    const journal = await Journal.open(dir, { captureMode: 'full' });
    const exchange = '00000000-0000-4000-8000-000000000001';
    const body = Buffer.from([0, 255, 128, 1, 0]);
    await journal.captureRequest(exchange, { url: '/devices/123?token=synthetic-token', method: 'POST',
      rawHeaders: ['Authorization', 'synthetic-secret'], httpVersion: '1.1' }, body, 'https:');
    const payload = Buffer.alloc(400000, 0xa5);
    const reply = Readable.from([payload]);
    reply.statusCode = 200; reply.rawHeaders = ['Set-Cookie', 'synthetic-cookie'];
    const completed = await journal.captureResponse(exchange, reply);
    journal.record('http.response', { exchange, body: completed }); await journal.flush();
    const events = await journal.recent();
    assert.equal(events[0].url, '/devices/123?token=synthetic-token');
    assert.deepEqual(events[0].headers, ['Authorization', 'synthetic-secret']);
    assert.deepEqual(await readFile(join(dir, events[0].body.file)), body);
    assert.deepEqual(await readFile(join(dir, completed.file)), payload);
    assert.equal(completed.bytes, 400000);
    assert.equal(journal.status().capture_mode, 'full');
    assert.equal(journal.status().capture_errors, 0);
    const restarted = await Journal.open(dir, { captureMode: 'full' });
    assert.equal((await restarted.recent()).length, 3);
  } finally { await rm(dir, { recursive: true }); }
});

test('invalid capture configuration fails explicitly', async () => {
  await assert.rejects(Journal.open('/unused', { captureMode: 'invalid' }), /CAPTURE_MODE/);
});
