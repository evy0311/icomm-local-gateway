import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { LocalAnsService } from '../src/ans-local.mjs';
import { decodeAnsPacket, encodeAnsPacket, ANS_TYPES } from '../src/ans-protocol.mjs';
import { registration } from './ans-helpers.mjs';
const material = Buffer.alloc(64, 5);
const dsn = 'SYNTHETIC123456';
const remote = { address: '127.0.0.1', port: 12345 };
function setup() {
  let clock = 0; const sent = []; const events = [];
  const identity = { dsn, ansKey: material.toString('base64') };
  const service = new LocalAnsService({ identity: () => identity, now: () => clock,
    send: (packet, to, done) => { sent.push({ packet, to }); done(); },
    record: (type, fields) => events.push({ type, ...fields }), random: n => Buffer.alloc(n, 8) });
  return { service, sent, events, identity, advance: n => { clock += n; },
    decode: i => decodeAnsPacket(sent.at(i).packet, material) };
}
function clientMessage(header, options = {}) {
  return encodeAnsPacket({ header, type: ANS_TYPES.keepalive, sequence: 13, senderClock: 2000, argument: 30, ...options }, material);
}

test('local ANS starts from its own material and maintains keepalives without cloud access', () => {
  const { service: s, sent, decode, advance } = setup();
  assert.equal(s.receive(registration(material), remote), true);
  const initial = decode(-1);
  assert.equal(initial.type, ANS_TYPES.registered); assert.equal(initial.sequence, 12); assert.equal(initial.argument, 30);
  assert.equal(s.receive(clientMessage(initial.header), remote), true);
  assert.equal(decode(-1).type, ANS_TYPES.keepaliveReply); assert.equal(decode(-1).sequence, 13);
  advance(30000); s.tick(); assert.equal(decode(-1).type, ANS_TYPES.probe);
  assert.equal(s.receive(clientMessage(initial.header, { type: ANS_TYPES.probeReply, sequence: decode(-1).sequence, senderClock: 32000 }), remote), true);
  advance(27000);
  assert.equal(s.receive(clientMessage(initial.header, { sequence: 14, senderClock: 59000 }), remote), true);
  assert.equal(decode(-1).type, ANS_TYPES.keepaliveReply);
  assert.equal(s.status().connected, true); assert.equal(sent.length, 4);
});

test('queued commands trigger a notification; delivery clears retries, acknowledgment preserves it', () => {
  const { service: s, decode, sent, advance } = setup();
  s.setPending('command-1'); assert.equal(sent.length, 0);
  s.receive(registration(material), remote); const header = decode(-1).header;
  s.receive(clientMessage(header), remote);
  const notice = decode(-1); assert.equal(notice.type, ANS_TYPES.notify);
  advance(4000); s.tick(); assert.equal(decode(-1).sequence, notice.sequence);
  s.receive(clientMessage(header, { type: ANS_TYPES.notifyReply, sequence: notice.sequence, senderClock: 6000 }), remote);
  const count = sent.length; advance(4000); s.tick(); assert.equal(sent.length, count);
  s.setPending(null); s.setPending('command-2'); assert.equal(decode(-1).type, ANS_TYPES.notify);
  s.setPending(null); const after = sent.length; advance(4000); s.tick(); assert.equal(sent.length, after);
});

test('wrong keys, endpoints, session tokens, old packets and expired sessions are rejected', () => {
  const { service: s, decode, advance, identity } = setup();
  assert.equal(s.receive(registration(Buffer.alloc(64, 9)), remote), false);
  assert.equal(s.status().registrations, 0);
  s.receive(registration(material), remote); const header = decode(-1).header;
  assert.equal(s.receive(clientMessage(header), { ...remote, address: '127.0.0.2' }), false);
  assert.equal(s.receive(clientMessage(Buffer.alloc(8)), remote), false);
  s.receive(clientMessage(header, { senderClock: 20000 }), remote);
  assert.equal(s.receive(clientMessage(header, { senderClock: 1000 }), remote), false);
  identity.ansKey = Buffer.alloc(64, 7).toString('base64');
  assert.equal(s.receive(clientMessage(header), remote), false);
  advance(100001); s.tick(); assert.equal(s.status().connected, false);
});

test('local ANS registration and keepalive cross actual UDP sockets with synthetic material', async () => {
  const server = dgram.createSocket('udp4'); server.bind(0, '127.0.0.1'); await once(server, 'listening');
  const client = dgram.createSocket('udp4');
  const s = new LocalAnsService({ identity: () => ({ dsn, ansKey: material.toString('base64') }),
    send: (p, to, done) => server.send(p, to.port, to.address, done) });
  server.on('message', (p, from) => s.receive(p, from));
  const exchange = async payload => {
    const result = once(client, 'message', { signal: AbortSignal.timeout(3000) });
    client.send(payload, server.address().port, '127.0.0.1');
    return decodeAnsPacket((await result)[0], material);
  };
  try {
    const initial = await exchange(registration(material)); assert.equal(initial.type, ANS_TYPES.registered);
    const reply = await exchange(clientMessage(initial.header)); assert.equal(reply.type, ANS_TYPES.keepaliveReply);
    assert.equal(s.stats.registrations, 1); assert.equal(s.stats.rejected, 0);
  } finally { client.close(); server.close(); }
});

test('registration retries are idempotent while replay from another endpoint is rejected', () => {
  const { service: s, decode, advance } = setup();
  const packet = registration(material);
  s.receive(packet, remote); const header = decode(-1).header;
  assert.equal(s.receive(packet, remote), true);
  assert.deepEqual(decode(-1).header, header);
  assert.equal(s.stats.registrations, 1);
  assert.equal(s.receive(packet, { ...remote, port: 999 }), false);
  advance(100001); s.tick();
  assert.equal(s.receive(packet, remote), false);
  assert.equal(s.receive(registration(material, dsn, { senderClock: 2000 }), remote), true);
  assert.equal(s.stats.registrations, 2);
});

test('session ID fits firmware 16-bit field and survives restart with clock continuity', () => {
  const { service: s, decode, advance, identity } = setup();
  s.receive(registration(material), remote);
  const header = decode(-1).header;
  assert.equal(header.readUInt32LE(0), 4);
  s.receive(clientMessage(header), remote);
  advance(10000);
  const saved = s.snapshot();
  const sent = [];
  const resumed = new LocalAnsService({ identity: () => identity, now: () => 0,
    wallNow: () => saved.savedAt + 2000, send: (p, r, done) => { sent.push(p); done(); } });
  assert.equal(resumed.restore(saved), true);
  assert.equal(resumed.clock(), 12000);
  assert.equal(resumed.receive(clientMessage(header, { senderClock: 14000 }), remote), true);
  assert.equal(decodeAnsPacket(sent.at(-1), material).type, ANS_TYPES.keepaliveReply);
  assert.equal(resumed.pendingId, null);
  assert.equal(resumed.restore({ ...saved, lastSeenAt: saved.savedAt - 100001 }), false);
  assert.equal(resumed.restore({ ...saved, header: Buffer.alloc(8).toString('base64') }), false);
  identity.ansKey = Buffer.alloc(64, 9).toString('base64');
  assert.equal(resumed.restore(saved), false);
});

 test('authenticated client probes and NAT port changes receive replies', () => {
 const { service: s, decode } = setup();
 s.receive(registration(material), remote); const header = decode(-1).header;
 assert.equal(s.receive(clientMessage(header, {type: ANS_TYPES.probe}), {...remote, port: 54321}), true);
 assert.equal(decode(-1).type, ANS_TYPES.probeReply);
 assert.equal(s.session.remote.port, 54321);
 });

test('manual wake polls without telemetry or pending appliance commands and survives timer updates', () => {
  const {service:s,decode,sent,advance}=setup();
  assert.throws(()=>s.requestPoll(), /lookup|connection/i);
  s.receive(registration(material),remote);const h=decode(-1).header;
  assert.throws(()=>s.requestPoll(), /connection/);
  s.receive(clientMessage(h),remote);
  s.requestPoll();const n=decode(-1);
  assert.equal(n.type,ANS_TYPES.notify);assert.equal(s.pendingId,null);
  s.setPending(null);advance(4000);s.tick();assert.equal(decode(-1).sequence,n.sequence);
  assert.throws(()=>s.requestPoll(),/ten seconds/);
  s.receive(clientMessage(h,{type:ANS_TYPES.notifyReply,sequence:n.sequence,senderClock:6000}),remote);
  assert.equal(s.status().poll_status,'acknowledged');
  s.polled();assert.equal(s.status().poll_status,'fetched');
  const count=sent.length;advance(4000);s.tick();assert.equal(sent.length,count);
  advance(100001);s.tick();assert.throws(()=>s.requestPoll(),/connection/);
});

test('manual polling preserves queued command identity and yields to the next command', () => {
  const {service:s,decode}=setup();s.receive(registration(material),remote);const h=decode(-1).header;
  s.receive(clientMessage(h),remote);s.setPending('queued-command');
  s.requestPoll();assert.equal(s.pendingId,'queued-command');
  s.setPending('next-command');assert.equal(s.session.notice.id,'next-command');
  assert.equal(decode(-1).type,ANS_TYPES.notify);
});
