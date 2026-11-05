import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import dgram from 'node:dgram';
import { createCloudProxy, publicResolver, validateCloudHost, endToEndHeaders, attachAnsBridge } from '../src/cloud.mjs';
import { createHeaterServer } from '../src/http.mjs';
import { Controller } from '../src/controller.mjs';
import { getProfile } from '../src/devices/index.mjs';
import { sample } from './helpers.mjs';

const host = 'synthetic-device.aylanetworks.com';

test('bridge host cannot be an arbitrary URL, IP, or unrelated host', () => {
  assert.equal(validateCloudHost(host), host);
  for (const value of ['', undefined, '127.0.0.1', 'https://' + host, host + ':443',
    'aylanetworks.com.evil.example', 'other.example', '-bad.aylanetworks.com']) {
    assert.throws(() => validateCloudHost(value));
  }
});

test('upstream resolution bypasses system DNS, caches answers, and rejects local addresses', async () => {
  let configured;
  let count = 0;
  const resolver = { setServers: (servers) => { configured = servers; },
    resolve4: async () => { count++; return [{ address: '192.168.1.2', ttl: 60 }, { address: '1.1.1.1', ttl: 60 }]; } };
  const resolve = publicResolver('8.8.8.8', resolver);
  assert.deepEqual(configured, ['8.8.8.8']);
  assert.equal(await resolve(host), '1.1.1.1');
  assert.equal(await resolve(host), '1.1.1.1');
  assert.equal(count, 1);
  resolver.resolve4 = async () => [{ address: '172.30.1.2', ttl: 60 }];
  await assert.rejects(publicResolver('8.8.8.8', resolver)(host), /public/);
});

test('proxy strips hop-by-hop headers without dropping authentication or cookies', () => {
  assert.deepEqual(endToEndHeaders({ connection: 'x-hop', 'x-hop': 'remove', authorization: 'synthetic-secret',
    'set-cookie': ['synthetic=1'], 'transfer-encoding': 'chunked' }),
  { authorization: 'synthetic-secret', 'set-cookie': ['synthetic=1'] });
});

test('cloud exchange preserves body, query and credentials, validates TLS, and never injects local commands', async () => {
  let observed;
  const vendorReply = '<commands><vendor-fixture/></commands>';
  const cloud = createCloudProxy({ host, resolve: async () => '1.1.1.1', log: () => {},
    request: (options, callback) => {
      const parts = [];
      return new Writable({ write(chunk, _encoding, done) { parts.push(chunk); done(); }, final(done) {
        observed = { options, body: Buffer.concat(parts) };
        const reply = Readable.from([vendorReply]);
        reply.statusCode = 200;
        reply.headers = { 'content-type': 'application/xml', 'set-cookie': ['synthetic=1'] };
        callback(reply); done();
      } });
    } });
  const controller = new Controller({ state: { instance: 'synthetic', vacationDays: 7 },
    save: async () => {}, profile: getProfile('reselec3'), gatewayMode: 'bridge', readOnly: false });
  assert.equal(controller.readOnly, true);
  const server = createHeaterServer(controller, (task) => task(), () => {}, { cloud });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const path = '/apiv1/devices/123/properties/superBlockDyn1/datapoints.xml?synthetic=1';
    const body = `<datapoint><value>${sample(120)}</value></datapoint>`;
    const result = await fetch(base + path, { method: 'POST', body, headers: { Authorization: 'synthetic-secret' } });
    assert.equal(await result.text(), vendorReply);
    assert.equal(observed.body.toString(), body);
    assert.equal(observed.options.path, path);
    assert.equal(observed.options.headers.authorization, 'synthetic-secret');
    assert.equal(observed.options.headers.host, host);
    assert.equal(observed.options.hostname, '1.1.1.1');
    assert.equal(observed.options.servername, host);
    assert.equal(observed.options.rejectUnauthorized, true);
    assert.equal(controller.state.latest.temperature, 120);
    await assert.rejects(controller.command('temperature', 121), /disabled/);
    assert.equal(await (await fetch(base + '/devices/123/commands.xml')).text(), vendorReply);
    // Unknown/malformed telemetry still reaches the vendor rather than breaking its exchange.
    assert.equal((await fetch(base + path, { method: 'POST', body: 'malformed' })).status, 200);
    assert.equal(observed.body.toString(), 'malformed');
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
});

test('upstream failure returns 502 without falling back to local success', async () => {
  const controller = new Controller({ state: {}, save: async () => {}, profile: getProfile('reselec3'), gatewayMode: 'bridge' });
  const cloud = { forward: async () => { throw new Error('fixture upstream failure'); } };
  const server = createHeaterServer(controller, (task) => task(), () => {}, { cloud });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ping`);
    assert.equal(response.status, 502);
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
});

test('failed upstream resolution is counted without attempting an HTTPS connection', async () => {
  let attempted = false;
  const cloud = createCloudProxy({ host, resolve: async () => { throw new Error('fixture DNS failure'); },
    request: () => { attempted = true; }, log: () => {} });
  await assert.rejects(cloud.forward({ url: '/ping' }, {}, Buffer.alloc(0)), /DNS failure/);
  assert.equal(attempted, false);
  assert.equal(cloud.stats.requests, 1);
  assert.equal(cloud.stats.errors, 1);
});

test('plain HTTP bridge preserves its original transport rather than inventing a redirect', async () => {
  let options;
  const cloud = createCloudProxy({ host, protocol: 'http:', resolve: async () => '1.1.1.1', log: () => {},
    request: (passed, callback) => {
      options = passed;
      return new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) {
        const reply = Readable.from(['fixture time response']);
        reply.statusCode = 200; reply.headers = {};
        callback(reply); done();
      } });
    } });
  const response = new Writable({ write(_chunk, _encoding, done) { done(); } });
  response.writeHead = () => {};
  await cloud.forward({ url: '/time', method: 'GET', headers: {} }, response, Buffer.alloc(0));
  assert.equal(options.port, 80);
  assert.equal(options.servername, undefined);
  assert.equal(options.path, '/time');
  assert.equal(cloud.stats.responses, 1);
});

test('ANS DNS failures do not crash an unbound UDP session', async () => {
  const listener = dgram.createSocket('udp4');
  listener.bind(0, '127.0.0.1'); await once(listener, 'listening');
  const bridge = attachAnsBridge(listener, { resolve: async () => { throw new Error('fixture DNS failure'); }, log: () => {} });
  const client = dgram.createSocket('udp4');
  try {
    client.send(Buffer.from('fixture'), listener.address().port, '127.0.0.1');
    const until = Date.now() + 2000;
    while (!bridge.stats.errors && Date.now() < until) await new Promise((done) => setTimeout(done, 10));
    assert.equal(bridge.stats.errors, 1);
    assert.equal(bridge.stats.sent, 0);
  } finally { bridge.close(); client.close(); listener.close(); }
});

test('ANS bridge relays real UDP packets in both directions without rewriting bytes', async () => {
  const upstream = dgram.createSocket('udp4');
  upstream.bind(0, '127.0.0.1'); await once(upstream, 'listening');
  upstream.on('message', (payload, remote) => upstream.send(payload, remote.port, remote.address));
  const listener = dgram.createSocket('udp4');
  listener.bind(0, '127.0.0.1'); await once(listener, 'listening');
  const bridge = attachAnsBridge(listener, { resolve: async () => '127.0.0.1', port: upstream.address().port, log: () => {} });
  const client = dgram.createSocket('udp4');
  try {
    const payload = Buffer.from([0, 1, 2, 255, 0, 128]);
    const returned = once(client, 'message', { signal: AbortSignal.timeout(3000) });
    client.send(payload, listener.address().port, '127.0.0.1');
    assert.deepEqual((await returned)[0], payload);
    assert.equal(bridge.stats.sent, 1);
    assert.equal(bridge.stats.received, 1);
  } finally { bridge.close(); client.close(); listener.close(); upstream.close(); }
});

test('bounded local UDP reply bypasses upstream only for the selected packet', async () => {
  const listener = dgram.createSocket('udp4');
  listener.bind(0, '127.0.0.1'); await once(listener, 'listening');
  let resolved = false;
  const events = [];
  const bridge = attachAnsBridge(listener, { resolve: async () => { resolved = true; throw new Error('must not forward'); },
    trial: { fromHeater: () => Buffer.from('local-reply') },
    journal: { captureMode: 'full', record: (type, fields) => events.push({ type, ...fields }) } });
  const client = dgram.createSocket('udp4');
  try {
    const returned = once(client, 'message', { signal: AbortSignal.timeout(3000) });
    client.send(Buffer.from('selected-request'), listener.address().port, '127.0.0.1');
    assert.equal((await returned)[0].toString(), 'local-reply');
    assert.equal(resolved, false); assert.equal(bridge.stats.sent, 0);
    assert.equal(bridge.stats.local_replies, 1);
    assert.deepEqual(events.filter(e => e.type === 'ans.trial.packet').map(e => e.direction),
      ['heater_to_local', 'local_to_heater']);
    assert.equal(Buffer.from(events[0].payload_base64, 'base64').toString(), 'selected-request');
  } finally { bridge.close(); client.close(); listener.close(); }
});
