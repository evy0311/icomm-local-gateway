import { createHash } from 'node:crypto';
export function registration(material, dsn = 'SYNTHETIC123456', { sequence = 12, senderClock = 1000, interval = 30 } = {}) {
  const name = Buffer.from(dsn + '\0');
  const body = Buffer.alloc(10); body[0] = 1; body[1] = 1;
  body.writeUInt16BE(sequence, 2); body.writeUInt32BE(senderClock, 4); body.writeUInt16BE(interval, 8);
  const prefix = Buffer.concat([Buffer.from([0, 0, name.length]), name, body]);
  return Buffer.concat([prefix, createHash('sha1').update(prefix).update(material.subarray(0, 16)).digest()]);
}
