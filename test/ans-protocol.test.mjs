import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { ansCrc8, decodeAnsPacket, encodeAnsPacket, ANS_TYPES } from '../src/ans-protocol.mjs';

// Synthetic material only. This fixed vector independently uses the standard
// AES-128-CBC primitive and a manually specified legacy frame/checksum.
const material = Buffer.from(Array.from({ length: 64 }, (_, i) => i));
const header = Buffer.from('0400000001020304', 'hex');
const iv = Buffer.alloc(16, 0x5a);

test('legacy CRC-8 uses polynomial 07, initial FF, no final XOR', () => {
  assert.equal(ansCrc8(Buffer.from('123456789')), 0xfb);
});

test('ANS codec preserves the encrypted keepalive fields and opaque envelope', () => {
  const message = { header, type: ANS_TYPES.keepalive, sequence: 0x1234,
    senderClock: 0x11223344, argument: 30, reserved: Buffer.alloc(5) };
  const body = Buffer.from('0107123411223344001e000000000000', 'hex');
  body[15] = ansCrc8(body.subarray(0, 15));
  const cipher = createCipheriv('aes-128-cbc', material.subarray(0, 16), iv);
  cipher.setAutoPadding(false);
  const packet = Buffer.concat([header, iv, cipher.update(body), cipher.final()]);
  assert.deepEqual(decodeAnsPacket(packet, material), message);
  assert.deepEqual(encodeAnsPacket(message, material, { iv }), packet);
  const reply = { ...message, type: ANS_TYPES.keepaliveReply, argument: 0 };
  assert.deepEqual(decodeAnsPacket(encodeAnsPacket(reply, material), material), reply);
});

test('ANS codec rejects truncation, corrupted ciphertext, and invalid configuration', () => {
  const message = { header, type: ANS_TYPES.probe, sequence: 1, senderClock: 123, argument: 0 };
  const packet = encodeAnsPacket(message, material, { iv });
  assert.throws(() => decodeAnsPacket(packet.subarray(1), material), /length/);
  const corrupt = Buffer.from(packet); corrupt[39] ^= 1;
  assert.throws(() => decodeAnsPacket(corrupt, material), /Invalid/);
  assert.throws(() => decodeAnsPacket(packet, Buffer.alloc(16)), /64 bytes/);
  assert.throws(() => encodeAnsPacket({ ...message, sequence: 65536 }, material), /field/);
  assert.throws(() => encodeAnsPacket({ ...message, type: 255 }, material), /type/);
});

test('initial registration validates keyed digest, device identity, and framing', async () => {
  const { decodeAnsRegistration } = await import('../src/ans-protocol.mjs');
  const { registration } = await import('./ans-helpers.mjs');
  const packet = registration(material);
  const dsn = 'SYNTHETIC123456';
  assert.deepEqual(decodeAnsRegistration(packet, material, dsn), { dsn, sequence: 12, senderClock: 1000, argument: 30 });
  const altered = Buffer.from(packet); altered[altered.length - 1] ^= 1;
  assert.throws(() => decodeAnsRegistration(altered, material, dsn), /signature/);
  assert.throws(() => decodeAnsRegistration(packet, Buffer.alloc(64, 9), dsn), /signature/);
  assert.throws(() => decodeAnsRegistration(packet, material, 'OTHER'), /device/);
  assert.throws(() => decodeAnsRegistration(packet.subarray(1), material, dsn), /registration/);
});
