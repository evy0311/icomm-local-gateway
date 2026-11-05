// Observed legacy Ayla ANS transport. This codec is separate from the UDP
// listener: decoding a packet does not authorize an appliance command.
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const ANS_TYPES = Object.freeze({ register: 1, registered: 2, probe: 5,
  probeReply: 6, keepalive: 7, keepaliveReply: 8, notify: 9, notifyReply: 10 });

export function ansCrc8(bytes) {
  let crc = 0xff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) & 0xff) ^ (crc & 0x80 ? 7 : 0);
  }
  return crc;
}

function sessionKey(material) {
  if (!Buffer.isBuffer(material) || material.length !== 64) throw new Error('ANS session material must be 64 bytes');
  return material.subarray(0, 16);
}

export function decodeAnsPacket(packet, material) {
  const key = sessionKey(material);
  if (!Buffer.isBuffer(packet) || packet.length !== 40) throw new Error('Unsupported ANS packet length');
  const decipher = createDecipheriv('aes-128-cbc', key, packet.subarray(8, 24));
  decipher.setAutoPadding(false);
  const body = Buffer.concat([decipher.update(packet.subarray(24)), decipher.final()]);
  if (body[0] !== 1 || ansCrc8(body.subarray(0, 15)) !== body[15]) throw new Error('Invalid ANS version or checksum');
  if (!Object.values(ANS_TYPES).includes(body[1])) throw new Error('Unsupported ANS message type');
  return { header: Buffer.from(packet.subarray(0, 8)), type: body[1], sequence: body.readUInt16BE(2),
    senderClock: body.readUInt32BE(4), argument: body.readUInt16BE(8),
    reserved: Buffer.from(body.subarray(10, 15)) };
}

export function encodeAnsPacket(message, material, { iv = randomBytes(16) } = {}) {
  const key = sessionKey(material);
  if (!Buffer.isBuffer(message.header) || message.header.length !== 8 || !Buffer.isBuffer(iv) || iv.length !== 16) {
    throw new Error('Invalid ANS envelope');
  }
  if (!Object.values(ANS_TYPES).includes(message.type)) throw new Error('Unsupported ANS message type');
  for (const [field, max] of [['sequence', 0xffff], ['senderClock', 0xffffffff], ['argument', 0xffff]]) {
    if (!Number.isInteger(message[field]) || message[field] < 0 || message[field] > max) throw new Error('Invalid ANS field');
  }
  const reserved = message.reserved ?? Buffer.alloc(5);
  if (!Buffer.isBuffer(reserved) || reserved.length !== 5) throw new Error('Invalid ANS reserved fields');
  const body = Buffer.alloc(16);
  body[0] = 1; body[1] = message.type;
  body.writeUInt16BE(message.sequence, 2); body.writeUInt32BE(message.senderClock, 4);
  body.writeUInt16BE(message.argument, 8); reserved.copy(body, 10);
  body[15] = ansCrc8(body.subarray(0, 15));
  const cipher = createCipheriv('aes-128-cbc', key, iv); cipher.setAutoPadding(false);
  return Buffer.concat([message.header, iv, cipher.update(body), cipher.final()]);
}

// The initial packet has a clear DSN and ten-byte message followed by a
// keyed SHA-1 suffix digest. This is the observed legacy format, not HMAC.
export function decodeAnsRegistration(packet, material, expectedDsn) {
  const key = sessionKey(material);
  if (!Buffer.isBuffer(packet) || packet.length < 35 || packet[0] !== 0 || packet[1] !== 0) {
    throw new Error('Invalid ANS registration envelope');
  }
  const length = packet[2];
  if (length < 2 || length > 65 || packet.length !== 33 + length || packet[2 + length] !== 0) {
    throw new Error('Invalid ANS registration length');
  }
  const dsn = packet.subarray(3, 2 + length).toString('utf8');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(dsn) || dsn !== expectedDsn) throw new Error('Different ANS device rejected');
  const signature = createHash('sha1').update(packet.subarray(0, -20)).update(key).digest();
  if (!timingSafeEqual(signature, packet.subarray(-20))) throw new Error('Invalid ANS registration signature');
  const body = packet.subarray(3 + length, -20);
  if (body[0] !== 1 || body[1] !== ANS_TYPES.register) throw new Error('Invalid ANS registration message');
  return { dsn, sequence: body.readUInt16BE(2), senderClock: body.readUInt32BE(4), argument: body.readUInt16BE(8) };
}
