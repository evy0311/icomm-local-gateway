export function sample(temperature = 120, mode = 1, days = 0) {
  const parts = [8, 140, 230, 52, 52].map((size) => Buffer.alloc(size));
  parts[3].writeUInt16BE(Math.round((temperature - 32) * 5 / 9 * 256));
  parts[3][30] = days;
  parts[3][31] = mode;
  return parts.map((part) => part.toString('hex')).join(',');
}
