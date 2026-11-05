import { loadStore } from './store.mjs';
import { getProfile } from './devices/index.mjs';
import { Controller } from './controller.mjs';
import { createHeaterServer } from './http.mjs';
import { createWebServer } from './admin.mjs';
import { loadSettings } from './settings.mjs';
import { dirname, join } from 'node:path';
import { startMqtt } from './mqtt.mjs';
import dgram from 'node:dgram';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createAnsKeepaliveTrial } from './ans-trial.mjs';
import { LocalAnsService } from './ans-local.mjs';
import { createCloudProxy, publicResolver, attachAnsBridge, validateCloudHost } from './cloud.mjs';
import { Journal } from './journal.mjs';
import { LocalDeviceService } from './local-service.mjs';

const env = process.env;
const settings = await loadSettings(join(dirname(env.DATA_FILE ?? '/data/state.json'), 'runtime.json'), {
  mode: env.GATEWAY_MODE ?? 'local', cloudHost: env.CLOUD_HOST ?? '', captureMode: env.CAPTURE_MODE ?? 'redacted' });
const { mode: gatewayMode, cloudHost, captureMode } = settings.current;
if (!['local', 'bridge'].includes(gatewayMode)) throw new Error('GATEWAY_MODE must be local or bridge');
if (gatewayMode === 'bridge') validateCloudHost(cloudHost);
const url = new URL(env.MQTT_URL ?? 'mqtt://broker:1883');
if (!['mqtt:', 'mqtts:'].includes(url.protocol)) throw new Error('MQTT_URL must use mqtt or mqtts');
if (url.username || url.password) throw new Error('Use MQTT_USERNAME and MQTT_PASSWORD, not credentials in MQTT_URL');
if (env.READ_ONLY && !['true', 'false'].includes(env.READ_ONLY)) throw new Error('READ_ONLY must be true or false');
const profile = getProfile(env.DEVICE_PROFILE ?? 'reselec3');
const store = await loadStore(env.DATA_FILE ?? '/data/state.json');
if (env.DEVICE_ID) {
  if (!/^\d+$/.test(env.DEVICE_ID)) throw new Error('Invalid configured device ID');
  if (store.state.deviceId && env.DEVICE_ID !== store.state.deviceId) throw new Error('Configured device does not match stored device');
  store.state.deviceId = env.DEVICE_ID;
  await store.save();
}
// One serialization boundary for HTTP, MQTT and timer mutations, including disk writes.
let tail = Promise.resolve();
const run = (task) => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
let bridge;
let ansLocal;
let ansSaveTail = Promise.resolve();
const ansSessionPath = join(dirname(env.DATA_FILE ?? '/data/state.json'), 'ans-session.json');
const persistAns = snapshot => {
  const body = JSON.stringify(snapshot);
  ansSaveTail = ansSaveTail.then(async () => {
    await writeFile(`${ansSessionPath}.tmp`, body, { mode: 0o600 });
    await rename(`${ansSessionPath}.tmp`, ansSessionPath);
  }).catch(() => { journal.record('ans.local.persistence_failed', {}); });
};
const controller = new Controller({ ...store, profile, gatewayMode, readOnly: env.READ_ONLY !== 'false', changed: () => { bridge?.report(); ansLocal?.setPending(store.state.pending?.status === 'queued' ? store.state.pending.id : localService?.reportingPending ? 'reporting-configuration' : null); } });
const journal = await Journal.open(env.JOURNAL_DIR ?? '/data/journal', { captureMode });
journal?.record('gateway.start', { mode: gatewayMode, read_only: controller.readOnly });
const resolve = gatewayMode === 'bridge' ? publicResolver(env.UPSTREAM_DNS ?? '1.1.1.1') : null;
const cloud = gatewayMode === 'bridge' ? createCloudProxy({ host: cloudHost, resolve, journal }) : null;
const localService = gatewayMode === 'local' ? new LocalDeviceService(controller, { configureReporting: true }) : null;
const heater = createHeaterServer(controller, run, console.log, { cloud, journal, localService, onPoll: () => ansLocal?.polled() });
const cloudHttp = gatewayMode === 'bridge' ? createCloudProxy({ host: cloudHost, resolve, protocol: 'http:', journal }) : null;
const plainHeater = createHeaterServer(controller, run, console.log, { cloud: cloudHttp, journal, localService, transport: 'http:', onPoll: () => ansLocal?.polled() });
const admin = createWebServer({ controller, journal, settings, name: env.DEVICE_NAME ?? 'A. O. Smith water heater',
  run, restart: () => { void stop().then(() => process.exit(0)); },
  ingress: env.HA_INGRESS === 'true',
  mqttStatus: () => ({ connected: bridge?.client.connected ?? false,
    label: url.hostname === 'broker' ? 'Private test broker' : 'Configured broker' }) });
const ans = dgram.createSocket('udp4');
ans.on('message', (payload, remote) => {
  if (gatewayMode !== 'local') return;
  journal.record('ans.local.received', { bytes: payload.length,
    ...(captureMode === 'full' ? { client_address: remote.address, client_port: remote.port,
      payload_base64: payload.toString('base64') } : {}) });
  ansLocal.receive(payload, remote);
});
if (gatewayMode === 'local') {
  ansLocal = new LocalAnsService({ persist: persistAns, identity: () => store.state.localIdentity,
    send: (payload, remote, done) => ans.send(payload, remote.port, remote.address, done),
    record: (type, fields) => journal.record(type, captureMode === 'full' ? fields
      : Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'payload_base64'))) });
  try { ansLocal.restore(JSON.parse(await readFile(ansSessionPath, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') journal.record('ans.local.resume_unavailable', {}); }
}
let ansTrial;
if (env.ANS_KEEPALIVE_TRIAL_FILE && gatewayMode === 'bridge') {
  const privateTrial = JSON.parse(await readFile(env.ANS_KEEPALIVE_TRIAL_FILE, 'utf8'));
  ansTrial = createAnsKeepaliveTrial(Buffer.from(privateTrial.material, 'base64'),
    { record: (type, fields) => journal.record(type, fields) });
}
const ansBridge = gatewayMode === 'bridge' ? attachAnsBridge(ans, { resolve, journal, trial: ansTrial }) : null;
controller.wake = async () => {
  if (gatewayMode !== 'local' || !ansLocal) throw new Error('Wake / poll requires local mode');
  ansLocal.requestPoll();
  bridge?.report();
};
controller.bridgeStatus = () => ({ https: { ...cloud?.stats }, http: { ...cloudHttp?.stats }, ans: ansLocal ? ansLocal.status() : { ...ansBridge?.stats }, journal: journal.status() });
ans.on('error', () => { console.error('ANS listener failed'); process.exit(1); });
const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(port, host, resolve);
});
await listen(heater, 8080, '0.0.0.0');
if (plainHeater) await listen(plainHeater, 8082, '0.0.0.0');
await listen(admin, 8081, '0.0.0.0');
await new Promise((resolve, reject) => { ans.once('error', reject); ans.bind(55055, '0.0.0.0', resolve); });
ansLocal?.setPending(store.state.pending?.status === 'queued' ? store.state.pending.id : localService?.reportingPending ? 'reporting-configuration' : null);
bridge = startMqtt({ url: url.href, username: env.MQTT_USERNAME, password: env.MQTT_PASSWORD,
  name: env.DEVICE_NAME ?? 'A. O. Smith water heater', discoveryPrefix: env.DISCOVERY_PREFIX ?? 'homeassistant', controller, run });
const ansTimer = setInterval(() => {
  ansLocal?.setPending(store.state.pending?.status === 'queued' ? store.state.pending.id : localService?.reportingPending ? 'reporting-configuration' : null);
  ansLocal?.tick();
}, 1000);
const timer = setInterval(() => {
  void run(async () => { await controller.expire(); bridge.report(); }).catch(() => {
    console.error('State persistence failed; shutting down'); process.exit(1);
  });
}, 30000);
console.log(`iCOMM MQTT running in ${gatewayMode} mode (${controller.readOnly ? 'read-only' : 'commands enabled'}); profile ${profile.id}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer); clearInterval(ansTimer);
  const closing = [heater, plainHeater, admin].filter(Boolean).map((server) => new Promise((done) => {
    server.close(done); server.closeIdleConnections();
  }));
  ansBridge?.close(); ans.close();
  const deadline = setTimeout(() => process.exit(1), 10000);
  await Promise.all([tail, ...closing]);
  await bridge.close();
  ansLocal?.save();
  await ansSaveTail;
  journal?.record('gateway.stop');
  await journal?.flush();
  clearTimeout(deadline);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
