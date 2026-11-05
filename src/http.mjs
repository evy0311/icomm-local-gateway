import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { extractDatapoint } from './decoder.mjs';
import { emptyCommandsXml, propertyCommandXml } from './protocol.mjs';

async function readBody(request, maxBytes = 65536) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Request too large');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export function createHeaterServer(controller, run, log = console.log, { cloud, journal, localService, transport = 'https:', onPoll = () => {} } = {}) {
  if (cloud && !controller.readOnly) throw new Error('Cloud bridge requires local commands to be disabled');
  return http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    const exchange = journal && !cloud ? randomUUID() : null;
    const captureFailure = () => {
      journal.captureErrors++; journal.lastError = 'Local HTTP capture failed';
      journal.record('capture.failure', { exchange, origin: 'local', reason: 'local_capture_failed' });
    };
    const reply = async (status, body = '', type = 'application/xml; charset=utf-8') => {
      const payload = Buffer.from(body);
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store',
        'Content-Length': String(payload.length), Date: new Date().toUTCString() };
      // Observed Ayla1.0 response echoes the device-supplied token, without
      // the scheme prefix. No cloud-issued response token is imported.
      const auth = request.headers['x-ayla-auth-key'];
      const token = typeof auth === 'string' && /^Ayla1\.0 ([A-Za-z0-9+/]{36})$/.exec(auth);
      if (token && status !== 401) headers['x-ayla-auth-key'] = token[1];
      if (exchange) {
        try {
          if (journal.captureMode === 'full') await journal.captureLocalReply(exchange, status,
            Object.entries(headers).flat(), payload);
          else journal.record('http.response', { exchange, origin: 'local', status,
            body: journal.body(payload, type) });
        } catch { captureFailure(); }
      }
      response.writeHead(status, headers);
      response.end(request.method === 'HEAD' ? undefined : payload);
    };
    try {
      const path = new URL(request.url, 'http://local').pathname;
      const publicSegments = new Set(['apiv1', 'api', 'v1', 'devices', 'properties', 'commands.xml',
        'ping', 'datapoints.xml', 'faultCode', 'superBlockDyn1', 'setBlockParameter', 'device.xml', 'properties.xml',
        'schedules.xml', 'time.xml', 'time', 'config.json']);
      const route = path.split('/').map((part) => !part || publicSegments.has(part) ? part : '<redacted>').join('/');
      log(`Heater HTTP ${request.method} ${route.slice(0, 200)}`);
      const normalizedPath = path.replace(/^\/apiv1(?=\/)/, '');
      const match = normalizedPath.match(/^\/devices\/(\d+)\/(commands\.xml|properties\/([A-Za-z0-9_]+)\/datapoints\.xml)$/);
      if (cloud) {
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) { await reply(405); return; }
        const body = await readBody(request, 4 * 1024 * 1024);
        // Observe verified telemetry, but never let an observer failure interrupt the real cloud exchange.
        if (request.method === 'POST' && ['superBlockDyn1', 'faultCode'].includes(match?.[3])) {
          try {
            await run(async () => {
              await controller.identify(match[1]);
              const value = extractDatapoint(body.toString('utf8'));
              if (match[3] === 'faultCode') await controller.fault(value);
              else await controller.telemetry(value);
            });
          } catch { log('Bridge telemetry could not be decoded; cloud request preserved'); }
        }
        try { await cloud.forward(request, response, body); }
        catch { log('Cloud bridge upstream request failed'); if (!response.headersSent) await reply(502); else response.destroy(); }
        return;
      }
      // Capture unknown startup routes as well as implemented commands and telemetry.
      // Reading the body once keeps the recording and handler on identical bytes.
      const localBody = await readBody(request);
      if (exchange) {
        try {
          if (journal.captureMode === 'full') await journal.captureRequest(exchange, request, localBody, transport);
          else journal.record('http.request', { exchange, origin: 'local', transport, method: request.method,
            ...journal.route(request.url), body: journal.body(localBody, request.headers['content-type'], match?.[3]) });
        } catch { captureFailure(); }
      }
      const lookup = normalizedPath.match(/^\/dsns\/([A-Za-z0-9_-]{1,64})\.xml$/);
      const oem = normalizedPath.match(/^\/devices\/(\d+)\/oem_info\.json$/);
      const deviceUpdate = normalizedPath.match(/^\/devices\/(\d+)\.xml$/);
      if (localService && deviceUpdate) {
        if (request.method !== 'PUT') { await reply(405); return; }
        await run(async () => { await reply(200, await localService.updateDevice(deviceUpdate[1], localBody.toString('utf8'))); });
        return;
      }
      if (localService && lookup) {
        if (request.method !== 'GET') { await reply(405); return; }
        await run(async () => { await reply(200, await localService.lookup(lookup[1])); });
        return;
      }
      if (localService && oem) {
        if (request.method !== 'PUT') { await reply(405); return; }
        await run(async () => { await reply(200, await localService.oemInfo(oem[1], localBody.toString('utf8')), 'application/json'); });
        return;
      }
      if (request.method === 'GET' && path === '/ping') { await reply(200, '', 'application/json'); return; }
      if (!match) { await reply(404); return; }
      if (!['GET', 'POST'].includes(request.method)) { await reply(405); return; }
      const body = localBody.toString('utf8');
      await run(async () => {
        await controller.identify(match[1]);
        if (request.method === 'GET' && match[2] === 'commands.xml') {
          const frame = await controller.deliver();
          const configuration = !frame && localService?.takeReportingConfiguration();
          onPoll();
          await reply(200, frame ? propertyCommandXml('setBlockParameter', frame)
            : configuration ? propertyCommandXml('periodicParameterSetting', configuration) : emptyCommandsXml());
        } else if (request.method === 'POST' && match[3]) {
          if (match[3] === 'superBlockDyn1') {
            const value = extractDatapoint(body);
            await controller.telemetry(value);
            log('Compatible heater report received');
          } else if (match[3] === 'faultCode') {
            await controller.fault(extractDatapoint(body));
            log('Heater fault report received');
          } else if (match[3] === 'setBlockParameter') {
            const value = extractDatapoint(body);
            await controller.acknowledge(value, { emptyReceipt: body.trim() === '' || /^\s*<datapoint>\s*<value>\s*<\/value>\s*<\/datapoint>\s*$/i.test(body) });
          }
          await reply(200, '', 'application/json');
        } else await reply(405);
      });
    } catch { log('Heater request rejected'); if (!response.headersSent) await reply(400); }
  });
}

export function createAdminServer(controller, { journal } = {}) {
  return http.createServer(async (request, response) => {
    try {
    const path = new URL(request.url, 'http://local').pathname;
    if (request.method === 'GET' && journal && path === '/journal') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ...journal.status(), events: await journal.recent(100) }, null, 2));
      return;
    }
    const capture = path.match(/^\/captures\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(request|response)$/);
    if (request.method === 'GET' && journal && capture) {
      const file = join(journal.directory, 'bodies', capture[1], `${capture[2]}.${capture[3]}.bin`);
      await stat(file);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${capture[2]}.${capture[3]}.bin"`, 'X-Content-Type-Options': 'nosniff' });
      createReadStream(file).on('error', () => response.destroy()).pipe(response);
      return;
    }
    if (request.method !== 'GET' || !['/health', '/state'].includes(path)) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(path === '/health' ? { ok: true, heater_online: controller.heaterConnected, telemetry_fresh: controller.available } : controller.publicState()));
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
}
