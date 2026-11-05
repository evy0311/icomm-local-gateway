import { appendFile, chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decodeSuperBlock } from './decoder.mjs';

const parser = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false });
const sensitive = /(?:auth|token|secret|passw|signature|credential|certificate|private|public_key|lan_key|api_key|serial|dsn|ssid|email|mac_addr|ip_addr)|^(?:id|key|user_id|device_id|owner|address|mac|ip|lanip)$/i;
const numeric = new Set(['status', 'code', 'time', 'utc_time', 'timezone', 'timeout', 'poll_interval',
  'period', 'port', 'length', 'count', 'duration', 'vacation_days', 'temperature', 'setpoint', 'version', 'api_version']);
const strings = new Set(['status', 'connection_status', 'model', 'oem_model', 'version', 'sw_version',
  'base-type', 'base_type', 'mime-type', 'mime_type', 'type', 'method']);
const literals = new Set(['setBlockParameter', 'superBlockDyn1', 'STANDARD', 'VACATION', 'true', 'false',
  'string', 'integer', 'boolean', 'float', 'online', 'offline', 'connected', 'disconnected']);
const staticPaths = new Set(['apiv1', 'api', 'v1', 'devices', 'dsns', 'properties', 'ping', 'time',
  'commands.xml', 'datapoints.xml', 'device.xml', 'properties.xml', 'schedules.xml', 'time.xml',
  'config.json', 'superBlockDyn1', 'setBlockParameter']);

export class Journal {
  constructor(directory, key, maxBytes) {
    Object.assign(this, { directory, key, maxBytes });
    this.session = randomUUID();
    this.sequence = 0; this.file = 0; this.bytes = 0; this.written = 0; this.lastError = null;
    this.captureErrors = 0;
    this.tail = Promise.resolve();
  }
  static async open(directory, { maxBytes = 10 * 1024 * 1024, captureMode = 'redacted' } = {}) {
    if (!['redacted', 'full'].includes(captureMode)) throw new Error('CAPTURE_MODE must be redacted or full');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const keyPath = join(directory, '.redaction-key');
    let key;
    try { key = await readFile(keyPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      key = randomBytes(32); await writeFile(keyPath, key, { mode: 0o600, flag: 'wx' });
    }
    const journal = new Journal(directory, key, maxBytes);
    journal.captureMode = captureMode;
    if (captureMode === 'full') await mkdir(join(directory, 'bodies', journal.session), { recursive: true, mode: 0o700 });
    const files = (await readdir(directory)).filter((name) => /^bridge-\d{8}\.jsonl$/.test(name)).sort();
    if (files.length) {
      journal.file = Number(files.at(-1).match(/\d+/)[0]);
      journal.bytes = (await stat(join(directory, files.at(-1)))).size;
    } else journal.file = 1;
    return journal;
  }
  fingerprint(value) {
    return createHmac('sha256', this.key).update(String(value)).digest('hex').slice(0, 16);
  }
  hidden(value) { return { redacted: true, type: typeof value, fingerprint: this.fingerprint(value) }; }
  route(url) {
    const parsed = new URL(url, 'http://local');
    const route = parsed.pathname.split('/').map((part) => {
      if (!part || staticPaths.has(part) || /^[a-z_]{1,32}\.(?:xml|json)$/.test(part)) return part;
      return `<id:${this.fingerprint(part)}>`;
    }).join('/');
    return { path: route.slice(0, 1024), query_keys: [...parsed.searchParams.keys()].map((key) =>
      /^[a-z_]{1,32}$/.test(key) ? key : '<redacted>') };
  }
  bodyPath(exchange, direction) { return join('bodies', this.session, `${exchange}.${direction}.bin`); }
  async captureRequest(exchange, incoming, body, transport) {
    const file = this.bodyPath(exchange, 'request');
    await writeFile(join(this.directory, file), body, { mode: 0o600, flag: 'wx' });
    this.record('http.request', { exchange, capture_mode: 'full', transport, method: incoming.method,
      url: incoming.url, http_version: incoming.httpVersion, headers: incoming.rawHeaders ?? incoming.headers,
      body: { file, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') } });
  }
  captureResponse(exchange, reply) {
    const file = this.bodyPath(exchange, 'response');
    const writer = createWriteStream(join(this.directory, file), { mode: 0o600, flags: 'wx' });
    const hash = createHash('sha256');
    let bytes = 0;
    this.record('http.response.headers', { exchange, capture_mode: 'full', status: reply.statusCode,
      status_message: reply.statusMessage, http_version: reply.httpVersion,
      headers: reply.rawHeaders ?? reply.headers, body_file: file });
    reply.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk); });
    reply.once('error', () => writer.destroy(new Error('Upstream body interrupted')));
    reply.once('aborted', () => writer.destroy(new Error('Upstream body interrupted')));
    const complete = new Promise((done) => {
      writer.once('finish', () => done({ file, bytes, sha256: hash.digest('hex') }));
      writer.once('error', () => { this.captureErrors++; this.lastError = 'Body capture failed'; done({ file, bytes, incomplete: true }); });
    });
    reply.pipe(writer);
    return complete;
  }
  async captureLocalReply(exchange, status, headers, body) {
    const file = this.bodyPath(exchange, 'response');
    await writeFile(join(this.directory, file), body, { mode: 0o600, flag: 'wx' });
    this.record('http.response.headers', { exchange, capture_mode: 'full', origin: 'local',
      status, headers, body_file: file });
    this.record('http.response', { exchange, capture_mode: 'full', origin: 'local', status,
      body: { file, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') } });
  }
  async recent(limit = 100) {
    const files = (await readdir(this.directory)).filter((name) => /^bridge-\d{8}\.jsonl$/.test(name)).sort().reverse();
    let events = [];
    for (const file of files) {
      const lines = (await readFile(join(this.directory, file), 'utf8')).trim().split('\n');
      const rows = lines.flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
      events = [...rows, ...events];
      if (events.length >= limit) break;
    }
    return events.slice(-limit);
  }
  structure(value, key = '', parent = null, depth = 0) {
    if (depth > 24) return { omitted: 'depth limit' };
    if (sensitive.test(key)) return this.hidden(JSON.stringify(value));
    if (Array.isArray(value)) return value.slice(0, 256).map((item) => this.structure(item, key, parent, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 256).map(([name, item]) =>
      [/^[\w@:#.-]{1,64}$/.test(name) ? name : '<redacted-key>', this.structure(item, name, value, depth + 1)]));
    if (typeof value === 'boolean' || value === null || value === '') return value;
    if (key === 'value' && parent?.name === 'setBlockParameter' && typeof value === 'string' &&
      /^BD 40 08 0B (?:[0-9A-F]{2} ){3}[0-9A-F]{2}$/i.test(value.trim())) return value.trim().toUpperCase();
    if (key === 'value' && parent?.name === 'superBlockDyn1') return this.telemetry(value);
    if (numeric.has(key) && Number.isFinite(Number(value)) && String(value).length < 20) return Number(value);
    if (literals.has(String(value))) return value;
    if (strings.has(key) && /^[a-zA-Z0-9_./ -]{1,64}$/.test(String(value))) return value;
    return this.hidden(value);
  }
  telemetry(value) {
    try {
      const decoded = decodeSuperBlock(value);
      return { segment_bytes: decoded.segmentBytes, setpoint: decoded.setpoint, mode: decoded.mode,
        fingerprint: this.fingerprint(value) };
    } catch { return { invalid_telemetry: true, fingerprint: this.fingerprint(value) }; }
  }
  body(buffer, contentType = '', property = '') {
    const meta = { bytes: buffer.length, fingerprint: this.fingerprint(buffer.toString('hex')) };
    if (!buffer.length) return meta;
    if (buffer.length > 256 * 1024) return { ...meta, omitted: 'structured capture limit' };
    const text = buffer.toString('utf8');
    try {
      let value;
      if (/json/i.test(contentType) || /^[\s]*[\[{]/.test(text)) value = JSON.parse(text);
      else if (/xml/i.test(contentType) || /^\s*</.test(text)) {
        if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Unsupported XML');
        value = parser.parse(text);
        if (property === 'superBlockDyn1' && value?.datapoint?.value) {
          return { ...meta, document: { datapoint: { value: this.telemetry(value.datapoint.value) } } };
        }
        if (property === 'setBlockParameter' && value?.datapoint) value.datapoint.name = property;
      } else return { ...meta, omitted: 'unstructured content' };
      return { ...meta, document: this.structure(value) };
    } catch { return { ...meta, omitted: 'unparseable content' }; }
  }
  record(type, data = {}) {
    const event = { at: new Date().toISOString(), session: this.session, sequence: ++this.sequence, type, ...data };
    const line = JSON.stringify(event) + '\n';
    this.tail = this.tail.then(async () => {
      if (this.bytes && this.bytes + Buffer.byteLength(line) > this.maxBytes) { this.file++; this.bytes = 0; }
      const file = join(this.directory, `bridge-${String(this.file).padStart(8, '0')}.jsonl`);
      await appendFile(file, line, { mode: 0o600 });
      this.bytes += Buffer.byteLength(line); this.written++; if (!this.captureErrors) this.lastError = null;
    }).catch(() => { this.lastError = 'Journal write failed'; console.error(this.lastError); });
  }
  status() { return { enabled: true, capture_mode: this.captureMode, written_this_session: this.written,
    capture_errors: this.captureErrors, file: this.file, error: this.lastError }; }
  async flush() { await this.tail; }
}
