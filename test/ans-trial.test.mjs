import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnsKeepaliveTrial } from '../src/ans-trial.mjs';
import { encodeAnsPacket, decodeAnsPacket, ANS_TYPES } from '../src/ans-protocol.mjs';
const material = Buffer.alloc(64, 7);
const remote = { address: '127.0.0.1', port: 12345 };
const header = Buffer.from('0400000001020304', 'hex');
const message = { header, sequence: 3, senderClock: 1000, argument: 30, type: ANS_TYPES.keepalive };

test('trial passes traffic through until a valid cloud message, then replies exactly once', () => {
  let clock = 100; const events = [];
  const trial = createAnsKeepaliveTrial(material, { now: () => clock, record: (type, fields) => events.push({ type, ...fields }) });
  const keepalive = encodeAnsPacket(message, material);
  assert.equal(trial.fromHeater(keepalive, remote), null);
  trial.fromCloud(encodeAnsPacket({ ...message, type: ANS_TYPES.keepaliveReply, argument: 0 }, material), remote);
  clock += 27000;
  const reply = decodeAnsPacket(trial.fromHeater(keepalive, remote), material);
  assert.equal(reply.type, ANS_TYPES.keepaliveReply); assert.equal(reply.sequence, 3);
  assert.equal(reply.senderClock, 28000); assert.equal(reply.argument, 0);
  clock += 27000;
  assert.equal(trial.fromHeater(encodeAnsPacket({ ...message, sequence: 4 }, material), remote), null);
  assert.ok(events.some(e => e.type === 'ans.trial.next.keepalive' && !e.same_sequence && e.elapsed_ms === 27000));
  assert.equal(trial.fromHeater(keepalive, remote), null);
});

test('trial never substitutes packets for a different endpoint, header, or stale anchor', () => {
  let clock = 0; const trial = createAnsKeepaliveTrial(material, { now: () => clock });
  trial.fromCloud(encodeAnsPacket({ ...message, type: ANS_TYPES.keepaliveReply }, material), remote);
  assert.equal(trial.fromHeater(encodeAnsPacket(message, material), { ...remote, port: 7 }), null);
  assert.equal(trial.fromHeater(encodeAnsPacket({ ...message, header: Buffer.alloc(8) }, material), remote), null);
  clock = 60001;
  assert.equal(trial.fromHeater(encodeAnsPacket(message, material), remote), null);
});

test('trial leaves unknown or corrupt datagrams on the ordinary bridge path', () => {
  const trial = createAnsKeepaliveTrial(material);
  assert.equal(trial.fromHeater(Buffer.alloc(49), remote), null);
  assert.equal(trial.fromCloud(Buffer.alloc(40), remote), undefined);
  assert.equal(trial.fromHeater(Buffer.alloc(40), remote), null);
});
