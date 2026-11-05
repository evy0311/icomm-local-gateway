import https from 'node:https';
import http from 'node:http';
import { Resolver } from 'node:dns/promises';
import { BlockList } from 'node:net';
import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix);

export function validateCloudHost(host) {
  if (typeof host !== 'string' || host.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+aylanetworks\.com$/.test(host)) {
    throw new Error('CLOUD_HOST must be an explicit aylanetworks.com hostname');
  }
  return host;
}

export function publicResolver(server = '1.1.1.1', resolver = new Resolver({ timeout: 2000, tries: 2 })) {
  resolver.setServers([server]);
  const cache = new Map();
  return async (host) => {
    const saved = cache.get(host);
    if (saved && saved.until > Date.now()) return saved.address;
    const records = await resolver.resolve4(host, { ttl: true });
    const record = records.find(({ address }) => !blocked.check(address));
    if (!record) throw new Error('Upstream DNS returned no public IPv4 address');
    cache.set(host, { address: record.address, until: Date.now() + Math.min(record.ttl, 300) * 1000 });
    return record.address;
  };
}

export function endToEndHeaders(headers) {
  const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
  for (const token of (headers.connection ?? '').split(',')) hop.add(token.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !hop.has(key.toLowerCase())));
}

export function createCloudProxy({ host, resolve, protocol = 'https:', request, log = console.log, journal }) {
  validateCloudHost(host);
  if (!['http:', 'https:'].includes(protocol)) throw new Error('Unsupported cloud transport');
  request ??= protocol === 'https:' ? https.request : http.request;
  const stats = { requests: 0, responses: 0, errors: 0, last_status: null, last_response_at: null };
  return { stats, async forward(incoming, response, body) {
    stats.requests++;
    const exchange = randomUUID();
    const started = Date.now();
    const property = incoming.url.match(/\/properties\/([A-Za-z0-9_]+)\/datapoints\.xml/)?.[1] ?? '';
    if (journal?.captureMode === 'full') {
      try { await journal.captureRequest(exchange, incoming, body, protocol); }
      catch { journal.captureErrors++; journal.lastError = 'Request capture failed';
        journal.record('capture.failure', { exchange, reason: 'request_capture_failed' }); }
    }
    else journal?.record('http.request', { exchange, transport: protocol, method: incoming.method,
      ...journal.route(incoming.url), authenticated: Boolean(incoming.headers.authorization),
      body: journal.body(body, incoming.headers['content-type'], property) });
    try {
    if (!incoming.url.startsWith('/') || incoming.url.startsWith('//')) throw new Error('Invalid request target');
    const address = await resolve(host);
    const headers = { ...endToEndHeaders(incoming.headers), host };
    if (body.length || !['GET', 'HEAD'].includes(incoming.method)) headers['content-length'] = String(body.length);
    await new Promise((resolveDone, reject) => {
      // Connect to the public address directly. SNI and certificate verification use the real cloud hostname.
      const upstream = request({ hostname: address, port: protocol === 'https:' ? 443 : 80,
        ...(protocol === 'https:' ? { servername: host, rejectUnauthorized: true } : {}),
        method: incoming.method, path: incoming.url, headers, timeout: 20000 }, (reply) => {
        stats.responses++;
        stats.last_status = reply.statusCode;
        stats.last_response_at = new Date().toISOString();
        log(`Cloud bridge response: HTTP ${reply.statusCode}`);
        const fullCapture = journal?.captureMode === 'full' ? journal.captureResponse(exchange, reply) : null;
        const capture = [];
        let total = 0;
        reply.on('data', (chunk) => {
          const bytes = Buffer.from(chunk);
          if (!fullCapture && total < 256 * 1024) capture.push(bytes.subarray(0, 256 * 1024 - total));
          total += bytes.length;
        });
        response.writeHead(reply.statusCode, endToEndHeaders(reply.headers));
        reply.on('error', (error) => { response.destroy(); reject(error); });
        reply.on('end', async () => {
          if (fullCapture) journal.record('http.response', { exchange, capture_mode: 'full', status: reply.statusCode,
            elapsed_ms: Date.now() - started, body: await fullCapture });
          else {
          journal?.record('http.response', { exchange, status: reply.statusCode, elapsed_ms: Date.now() - started,
            response_bytes: total, truncated: total > 256 * 1024,
            body: journal.body(Buffer.concat(capture), reply.headers['content-type']) });
          }
          resolveDone();
        });
        reply.pipe(response);
      });
      upstream.once('timeout', () => upstream.destroy(new Error('Cloud request timed out')));
      upstream.once('error', reject);
      response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
      upstream.end(body);
    });
    } catch (error) { stats.errors++; journal?.record('http.failure', { exchange, elapsed_ms: Date.now() - started,
      reason: error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'upstream_failure' }); throw error; }
  } };
}

// One real upstream UDP socket per client endpoint preserves the authenticated ANS session.
// Payloads stay in memory only. The local default mode does not call this function.
export function attachAnsBridge(listener, { resolve, host = 'ans-field.aylanetworks.com', log = console.log,
  createSocket = () => dgram.createSocket('udp4'), port = 55055, journal, trial }) {
  validateCloudHost(host);
  const sessions = new Map();
  const closeSocket = (socket) => { try { socket.close(); } catch { /* Already closed or never bound. */ } };
  const stats = { sent: 0, received: 0, errors: 0, last_heater_packet_at: null, ...(trial ? { local_replies: 0 } : {}) };
  listener.on('message', (payload, remote) => {
    if (payload.length > 8192) return;
    stats.last_heater_packet_at = new Date().toISOString();
    const localReply = trial?.fromHeater(payload, remote);
    if (localReply) {
      journal?.record('ans.trial.packet', { direction: 'heater_to_local', bytes: payload.length,
        ...(journal.captureMode === 'full' ? { payload_base64: payload.toString('base64') } : {}) });
      listener.send(localReply, remote.port, remote.address, (error) => {
        if (error) stats.errors++;
        else {
          stats.local_replies++;
          journal?.record('ans.trial.packet', { direction: 'local_to_heater', bytes: localReply.length,
            ...(journal.captureMode === 'full' ? { payload_base64: localReply.toString('base64') } : {}) });
        }
      });
      return;
    }
    const key = `${remote.address}:${remote.port}`;
    let session = sessions.get(key);
    if (!session) {
      if (sessions.size >= 8) return;
      const socket = createSocket();
      session = { socket, touched: Date.now(), id: randomUUID() };
      journal?.record('ans.session.open', { connection: session.id,
        ...(journal.captureMode === 'full' ? { client_address: remote.address, client_port: remote.port } : {}) });
      sessions.set(key, session);
      socket.on('message', (reply) => {
        session.touched = Date.now();
        stats.received++;
        trial?.fromCloud(reply, remote);
        journal?.record('ans.packet', { connection: session.id, direction: 'cloud_to_heater', bytes: reply.length,
          ...(journal.captureMode === 'full' ? { payload_base64: reply.toString('base64') } : {}) });
        listener.send(reply, remote.port, remote.address, (error) => { if (error) stats.errors++; });
      });
      socket.on('error', () => {
        stats.errors++; sessions.delete(key); closeSocket(socket); log('ANS bridge connection failed');
        journal?.record('ans.failure', { connection: session.id });
      });
      session.ready = resolve(host).then((address) => new Promise((done, reject) => {
        socket.once('error', reject); socket.connect(port, address, done);
      }));
    }
    session.touched = Date.now();
    void session.ready.then(() => new Promise((done, reject) => {
      session.socket.send(payload, (error) => { if (error) reject(error); else { stats.sent++;
        journal?.record('ans.packet', { connection: session.id, direction: 'heater_to_cloud', bytes: payload.length,
          ...(journal.captureMode === 'full' ? { payload_base64: payload.toString('base64') } : {}) }); done(); } });
    })).catch(() => { stats.errors++; if (sessions.delete(key)) closeSocket(session.socket); });
  });
  const timer = setInterval(() => {
    for (const [key, session] of sessions) if (Date.now() - session.touched > 600000) {
      journal?.record('ans.session.expired', { connection: session.id });
      closeSocket(session.socket); sessions.delete(key);
    }
  }, 60000);
  return { stats, close() { clearInterval(timer); for (const session of sessions.values()) closeSocket(session.socket); sessions.clear(); } };
}
