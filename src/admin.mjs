import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const webRoot = new URL('./web/', import.meta.url);

export function createWebServer({ controller, journal, settings, name, run, restart, mqttStatus, ingress = false }) {
  const token = randomUUID();
  const json = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  return http.createServer({ requestTimeout: 10000 }, async (request, response) => {
    const peer = request.socket.remoteAddress?.replace(/^::ffff:/, '');
    const trustedIngress = ingress && peer === '172.30.32.2';
    if (ingress && !trustedIngress && !(['127.0.0.1', '::1'].includes(peer) && request.url === '/health')) {
      json(response, 403, { error: 'Home Assistant ingress required' }); return;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors ${ingress ? "'self'" : "'none'"}; base-uri 'self'`);
    try {
      const path = new URL(request.url, 'http://local').pathname;
      if (request.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path);
        const body = await readFile(new URL(file, webRoot));
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); return;
      }
      if (request.method === 'GET' && ['/state', '/health'].includes(path)) {
        json(response, 200, path === '/state' ? controller.publicState() : { ok: true, heater_online: controller.heaterConnected, telemetry_fresh: controller.available }); return;
      }
      if (request.method === 'GET' && path === '/api/devices') {
        json(response, 200, { devices: controller.state.deviceId ? [{ id: controller.state.instance,
          name, model: controller.profile.model, manufacturer: controller.profile.manufacturer,
          profile: controller.profile.id, state: controller.publicState() }] : [],
          gateway: { mode: controller.gatewayMode, mqtt: mqttStatus(), capture: journal?.status() ?? { enabled: false } } }); return;
      }
      if (request.method === 'GET' && path === '/api/settings') {
        json(response, 200, { ...settings.current, csrf: token, localCommandsEnabled: !controller.readOnly,
          journalAvailable: Boolean(journal) }); return;
      }
      if (request.method === 'GET' && ['/api/journal', '/journal'].includes(path)) {
        json(response, 200, { ...(journal?.status() ?? { enabled: false }), events: journal ? await journal.recent(100) : [] }); return;
      }
      const capture = path.match(/^\/captures\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(request|response)$/);
      if (request.method === 'GET' && journal && capture) {
        const file = join(journal.directory, 'bodies', capture[1], `${capture[2]}.${capture[3]}.bin`);
        await stat(file);
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${capture[2]}.${capture[3]}.bin"` });
        createReadStream(file).on('error', () => response.destroy()).pipe(response); return;
      }
      if (['POST', 'DELETE'].includes(request.method)) {
        const origin = request.headers.origin ? new URL(request.headers.origin) : null;
        if (request.headers['x-icomm-token'] !== token ||
          (!trustedIngress && origin && (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host)) ||
          request.headers['sec-fetch-site'] === 'cross-site') { json(response, 403, { error: 'Reload this page before saving' }); return; }
        let body = {};
        if (request.method === 'POST') {
          if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) { json(response, 415, { error: 'JSON required' }); return; }
          const chunks = []; let bytes = 0;
          for await (const chunk of request) { bytes += chunk.length; if (bytes > 8192) throw new Error('Request too large'); chunks.push(chunk); }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        if (path === '/api/settings') {
          if (request.method === 'DELETE') await settings.reset(); else await settings.save(body);
          journal?.record('gateway.settings.changed', { restart: true });
          await journal?.flush();
          json(response, 202, { restarting: true });
          setTimeout(restart, 350); return;
        }
        const command = path.match(/^\/api\/devices\/([0-9a-f-]{36})\/commands$/);
        if (request.method === 'POST' && command?.[1] === controller.state.instance) {
          await run(async () => {
            if (body.kind === 'wake') await controller.wake();
            else if (body.kind === 'cancel') await controller.cancelQueued();
            else {
              if (body.allow_stale !== undefined && typeof body.allow_stale !== 'boolean') throw new Error('allow_stale must be boolean');
              await controller.command(body.kind, body.value, { allowStale: body.allow_stale === true });
              if (body.allow_stale) journal?.record('gateway.command.diagnostic', { kind: body.kind, value: body.value, allow_stale: true });
            }
          });
          json(response, 202, { accepted: true }); return;
        }
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) { if (!response.headersSent) json(response, 400, { error: error.code === 'ENOENT' ? 'Not found' : error.message }); else response.destroy(); }
  });
}
