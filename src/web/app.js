const main = document.querySelector('#main');

// Lucide icons, ISC license: https://lucide.dev/license
const iconPaths = {
  devices: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 11h14M9 7v1M9 15v2"/>',
  traffic: '<path d="M3 7h18l-4-4M21 17H3l4 4"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
  open: '<path d="M7 17 17 7M7 7h10v10"/>',
  heater: '<rect x="5" y="3" width="14" height="18" rx="5"/><path d="M9 3V1m6 2V1M9 21v2m6-2v2M9 8h6M12 12v5"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] ?? ''}</svg>`;
document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
const status = (available) => `<span class="device-status"><span class="dot ${available ? 'good' : 'bad'}"></span>${available ? 'Heater connected' : 'Waiting for connection'}</span>`;

let snapshot = { devices: [], gateway: {} }, settings, events = [], search = '', filter = 'all', restarting = false, busy = false;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = (value) => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'No report yet';
const relative = (value) => { if (!value) return 'Waiting for first report'; const sec = Math.max(0, Math.floor((Date.now() - new Date(value)) / 1000)); return sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.floor(sec / 60)}m ago` : `${Math.floor(sec / 3600)}h ago`; };
const modeName = () => snapshot.gateway.mode === 'bridge' ? 'Cloud bridge' : 'Local mode';
function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { box.hidden = true; }, 6000); }
async function api(path, options = {}) {
  const response = await fetch(new URL(path.replace(/^\/+/, ''), document.baseURI), { cache: 'no-store', ...options });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? 'Request failed'); return value;
}
async function configure(patch, reset = false) {
  if (busy) return; busy = true;
  try {
    settings = await api('/api/settings');
    await api('/api/settings', { method: reset ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json', 'X-iCOMM-Token': settings.csrf }, ...(reset ? {} : { body: JSON.stringify(patch) }) });
    restarting = true; toast('Saved. The gateway is restarting to apply your settings.');
    document.querySelector('#connection').textContent = 'Applying settings…';
    setTimeout(async () => { busy = false; await refresh(true); }, 2200);
  } catch (error) { busy = false; toast(error.message); }
}
function bridgeSwitch() { return `<label class="switch"><input id="bridge-toggle" type="checkbox" ${snapshot.gateway.mode === 'bridge' ? 'checked' : ''}><span>Bridge mode</span></label>`; }
function bindSwitch() { document.querySelector('#bridge-toggle')?.addEventListener('change', async (event) => {
  settings ??= await api('/api/settings');
  if (event.target.checked && !settings.cloudHost) { location.hash = '#settings'; toast('Enter the device-service hostname before enabling the bridge.'); return; }
  configure({ mode: event.target.checked ? 'bridge' : 'local' });
}); }
function renderDevices() {
  const cards = snapshot.devices.map((device) => `<a class="panel device-card" href="#device/${encodeURIComponent(device.id)}"><div class="device-top"><span class="appliance">${icon('heater')}</span><div><h2>${escape(device.name)}</h2><div class="muted model">${escape(device.model)}</div></div><span class="arrow">${icon('arrow')}</span></div><div class="device-values"><div><span class="label">Last reported setpoint</span><span class="value setpoint-value">${escape(device.state.temperature ?? '—')}<span class="unit">°F</span></span></div><div><span class="label">Operating mode</span><span class="value">${escape(device.state.mode === 'STANDARD' ? 'Standard' : device.state.mode === 'VACATION' ? 'Vacation' : '—')}</span></div></div><div class="row">${status(device.state.heater_connected)}<span class="small muted">${relative(device.state.received_at)}</span></div></a>`).join('');
  main.innerHTML = `<div class="page-head"><div><div class="eyebrow">Appliance monitoring</div><h1>Devices</h1><p>Reported settings and connection activity from your water heater</p></div>${bridgeSwitch()}</div><div class="pills toolbar"><span class="meta-item"><span class="dot good"></span>${modeName()}</span><span class="meta-item">${snapshot.devices.length} device${snapshot.devices.length === 1 ? '' : 's'}</span><span class="meta-item">${escape(snapshot.gateway.capture?.capture_mode ?? 'No')} capture</span></div>${cards || '<div class="empty"><h2>Waiting for a water heater</h2><p>Configure the bridge, add its DNS rewrites, and connect the heater to your Wi-Fi.<br>Your device appears here after its first telemetry report.</p><a class="button primary" href="#settings">Open settings</a></div>'}`;
  bindSwitch();
}
function renderDevice(id) {
  const device = snapshot.devices.find((item) => item.id === id);
  if (!device) { main.innerHTML = '<div class="empty">Device not found. <a href="#devices">Return to devices</a></div>'; return; }
  const state = device.state, stats = state.bridge ?? {}, disabled = !state.temperature_commands_enabled;
  main.innerHTML = `<a class="back" href="#devices">${icon('back')} All devices</a><div class="page-head"><div><div class="eyebrow">${escape(device.manufacturer)}</div><h1>${escape(device.name)}</h1><p class="model">${escape(device.model)}</p></div>${status(state.heater_connected)}</div><div class="grid telemetry"><section class="panel setpoint"><span class="label">Last reported setpoint</span><div class="value large">${escape(state.temperature ?? '—')}<span class="unit">°F</span></div></section><section class="panel"><span class="label">Operating mode</span><div class="value operating-mode">${state.mode === 'STANDARD' ? 'Standard' : state.mode === 'VACATION' ? 'Vacation' : '—'}</div></section><section class="panel"><span class="label">Last report</span><div class="value report-age">${relative(state.received_at)}</div><span class="small muted">${time(state.received_at)}</span></section></div><section class="panel estimate-panel"><div class="row"><h2>Reported faults</h2><strong>${state.water_leak_detected === true ? 'Water leak detected' : state.water_leak_detected === false ? 'Leak alert cleared' : 'Leak state unknown'}</strong></div><p>Fault code: <strong>${escape(state.fault_code ?? 'Unknown')}${state.fault_code === 0 ? ' · None' : state.fault_code === 31 ? ' · Water leak' : ''}</strong></p><p class="small muted">Last fault report: ${time(state.fault_received_at)}. Leak alerts remain active until fault code 0 is reported. A cleared alert does not verify sensor connectivity.</p></section><section class="panel estimate-panel"><div class="row"><h2>Estimated hot-water level</h2><span class="pill">Provisional · low confidence</span></div><div class="value">${state.hot_water_estimate?.bars ? `${escape(state.hot_water_estimate.bars)} / 3 bars · ${escape(state.hot_water_estimate.level)}` : 'Unknown'}</div><p class="small">${state.available ? 'Based on the latest report.' : 'Last reported estimate; the heater sends data when it changes.'} A tentative temperature-like reading is compared with the reported setpoint. This is an assumption, not the manufacturer’s hot-water status.</p><details><summary>How this estimate works</summary><p class="small">3 bars: within 15°F of the setpoint. 2 bars: more than 15°F and up to 30°F below. 1 bar: more than 30°F below. Only the initial three-bar observation has been compared; lower levels need verification after normal hot-water use. No estimate in Vacation mode.</p><p class="small">Unverified input: ${escape(state.hot_water_estimate?.candidate_fahrenheit ?? '—')}°F · deficit: ${escape(state.hot_water_estimate?.deficit_fahrenheit ?? '—')}°F. Not a measured tank temperature, percentage, or water-volume estimate.</p></details></section><div class="detail-grid"><section class="panel"><div class="row"><h2>Connection & control</h2>${bridgeSwitch()}</div><div class="facts"><div><span class="label">Gateway mode</span><strong>${modeName()}</strong></div><div><span class="label">Command source</span><strong>${state.gateway_mode === 'bridge' ? 'Official app / cloud' : state.read_only ? 'Read-only monitoring' : 'Local gateway'}</strong></div><div><span class="label">MQTT</span><strong>${snapshot.gateway.mqtt?.connected ? 'Connected' : 'Disconnected'} · ${escape(snapshot.gateway.mqtt?.label ?? '')}</strong></div><div><span class="label">Local command status</span><strong>${escape(state.command_status)}</strong></div></div><div class="section-links"><button id="wake-heater" ${state.gateway_mode !== 'local' || !stats.ans?.poll_ready ? 'disabled' : ''}>Wake / poll</button><span class="small muted">${escape(stats.ans?.poll_status ?? 'idle')}</span></div><p class="small">Asks the heater to check for commands. Does not change temperature or confirm fresh telemetry.</p><form id="temperature-form" class="command-form"><label for="temperature">Local target</label><input id="temperature" type="number" min="95" max="130" step="1" value="${escape(state.temperature >= 95 ? state.temperature : 120)}" ${disabled ? 'disabled' : ''}><button class="primary" ${disabled ? 'disabled' : ''}>Set °F</button></form><p class="small spaced">${state.gateway_mode === 'bridge' ? 'Local commands are disabled while the real cloud controls the heater.' : state.read_only ? 'Read-only mode is enabled in the deployment configuration.' : 'Temperature updates can be queued while reports are stale. They are sent at the next heater check-in and confirmed by a new report.'}</p></section><section class="panel"><div class="row"><h2>Bridge activity</h2><span class="meta-item">${escape(snapshot.gateway.capture?.capture_mode ?? 'No')} capture</span></div><div class="facts"><div><span class="label">HTTPS exchanges</span><strong>${stats.https?.responses ?? 0}</strong></div><div><span class="label">Last cloud status</span><strong>${stats.https?.last_status ?? '—'}</strong></div><div><span class="label">UDP → cloud</span><strong>${stats.ans?.sent ?? 0} packets</strong></div><div><span class="label">UDP → heater</span><strong>${stats.ans?.received ?? 0} packets</strong></div></div><div class="section-links"><a class="button" href="#captures">View traffic ${icon('open')}</a><a class="button" href="#settings">Settings</a></div></section></div>`;
  bindSwitch();
  document.querySelector('#wake-heater').addEventListener('click', async () => {
    try { settings = await api('/api/settings'); await api(`/api/devices/${encodeURIComponent(id)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-iCOMM-Token': settings.csrf }, body: JSON.stringify({kind: 'wake'}) }); toast('UDP poll requested. Waiting for the heater to check in.'); }
    catch (error) { toast(error.message, true); }
  });
  document.querySelector('#temperature-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { settings = await api('/api/settings'); await api(`/api/devices/${encodeURIComponent(id)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-iCOMM-Token': settings.csrf }, body: JSON.stringify({ kind: 'temperature', value: Number(document.querySelector('#temperature').value) }) }); toast('Local command queued. Waiting for heater confirmation.'); }
    catch (error) { toast(error.message); }
  });
}
function trafficRows() {
  const visible = events.slice().reverse().filter((event) => (filter === 'all' || event.type.startsWith(filter)) && JSON.stringify(event).toLowerCase().includes(search.toLowerCase()));
  document.querySelector('#traffic-body').innerHTML = visible.map((event) => {
    const index = events.indexOf(event), url = event.url ?? event.path ?? event.direction ?? event.mode ?? '';
    return `<tr data-event="${index}"><td class="timestamp">${time(event.at)}</td><td><span class="event-kind">${escape(event.type)}</span></td><td class="route">${escape(event.method ?? '')} ${escape(url)}</td><td>${escape(event.status ?? event.bytes ?? '—')}</td><td><button class="event-open" aria-label="Inspect ${escape(event.type)} at ${time(event.at)}">${icon('open')}</button></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">No matching events yet. New exchanges appear here automatically.</td></tr>';
  document.querySelectorAll('[data-event]').forEach((row) => row.addEventListener('click', () => openEvent(events[Number(row.dataset.event)])));
}
function openEvent(event) {
  const container = document.querySelector('#event-details'); container.replaceChildren();
  const linked = event.exchange ? events.filter((item) => item.exchange === event.exchange) : [event];
  const links = document.createElement('div'); links.className = 'section-links';
  for (const item of linked) {
    const file = item.body?.file ?? item.body_file;
    if (file && item.exchange) {
      const direction = file.endsWith('.request.bin') ? 'request' : 'response';
      const href = `./captures/${encodeURIComponent(item.session)}/${encodeURIComponent(item.exchange)}/${direction}`;
      if ([...links.children].some((child) => child.getAttribute('href') === href)) continue;
      const link = document.createElement('a'); link.className = 'button'; link.href = href; link.textContent = `Download ${direction} body`; links.append(link);
    }
  }
  if (links.children.length) container.append(links);
  const pre = document.createElement('pre'); pre.textContent = JSON.stringify(linked, null, 2); container.append(pre);
  document.querySelector('#event-dialog').showModal();
}
async function renderCaptures() {
  const capture = snapshot.gateway.capture ?? {};
  main.innerHTML = `<div class="page-head"><div><div class="eyebrow">Protocol capture</div><h1>Traffic & captures</h1><p>Inspect setup, telemetry, commands, and notification sessions</p></div><span class="pill blue">${escape(capture.capture_mode ?? 'Capture disabled')}</span></div><div class="grid capture-stats"><section class="panel"><span class="label">Events this session</span><div class="value" id="event-count">${capture.written_this_session ?? 0}</div></section><section class="panel"><span class="label">Storage</span><div class="value">Persistent volume</div></section><section class="panel"><span class="label">Capture errors</span><div class="value" id="capture-errors">${capture.capture_errors ?? 0}</div></section></div><div class="traffic-head toolbar"><input id="search" type="search" placeholder="Search traffic" aria-label="Search traffic"><select id="filter" aria-label="Filter traffic"><option value="all">All events</option><option value="http.">HTTP exchanges</option><option value="ans.">UDP notifications</option><option value="gateway.">Gateway events</option></select><button id="refresh-captures">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Route / direction</th><th>Status / bytes</th><th></th></tr></thead><tbody id="traffic-body"></tbody></table></div><p class="small spaced">Showing the latest 100 events. Journal files rotate without deleting older sessions. Full captures retain original headers, body files, and UDP payload bytes.</p>`;
  document.querySelector('#search').value = search; document.querySelector('#filter').value = filter;
  document.querySelector('#search').addEventListener('input', (event) => { search = event.target.value; trafficRows(); });
  document.querySelector('#filter').addEventListener('change', (event) => { filter = event.target.value; trafficRows(); });
  document.querySelector('#refresh-captures').addEventListener('click', loadEvents);
  await loadEvents();
}
async function loadEvents() {
  try { const journal = await api('/api/journal'); events = journal.events;
    if (document.querySelector('#traffic-body')) { trafficRows(); document.querySelector('#event-count').textContent = journal.written_this_session ?? 0; document.querySelector('#capture-errors').textContent = journal.capture_errors ?? 0; }
  } catch (error) { toast(error.message); }
}
async function renderSettings() {
  settings = await api('/api/settings');
  main.innerHTML = `<div class="page-head"><div><div class="eyebrow">Gateway configuration</div><h1>Settings</h1><p>Configure cloud forwarding and private traffic capture</p></div></div><form id="settings-form" class="panel settings"><h2>Connection & capture</h2><div class="field"><label for="gateway-mode">Connection mode</label><select id="gateway-mode"><option value="bridge">Cloud bridge</option><option value="local">Local only</option></select><p class="small">Bridge forwards the heater’s exchanges to its real cloud. Local only uses the implemented local handlers.</p></div><div class="field"><label for="cloud-host">Device-service hostname</label><input id="cloud-host" autocomplete="off" spellcheck="false" placeholder="Exact hostname from the heater’s DNS requests"><p class="small">Use the complete device-service hostname, ending in .aylanetworks.com.</p></div><div class="field"><label for="capture-mode">Capture mode</label><select id="capture-mode"><option value="full">Full headers, bodies & UDP bytes</option><option value="redacted">Redacted structured trace</option></select><p class="small">Captures stay in the private data volume and are excluded from source packages.</p></div><div class="note">Saving restarts this gateway briefly. The heater may need to reconnect after switching connection modes. Your saved device and captures are retained.</div><div class="toolbar"><button class="primary" type="submit">Save settings</button><button id="reset-settings" type="button">Use deployment defaults</button></div><div id="save-status" class="status-line"></div></form>`;
  document.querySelector('#gateway-mode').value = settings.mode; document.querySelector('#cloud-host').value = settings.cloudHost ?? ''; document.querySelector('#capture-mode').value = settings.captureMode;
  document.querySelector('#settings-form').addEventListener('submit', (event) => { event.preventDefault(); configure({ mode: document.querySelector('#gateway-mode').value, cloudHost: document.querySelector('#cloud-host').value.trim(), captureMode: document.querySelector('#capture-mode').value }); });
  document.querySelector('#reset-settings').addEventListener('click', () => configure({}, true));
}
async function render() {
  const route = location.hash.slice(1) || 'devices';
  document.querySelectorAll('[data-nav]').forEach((link) => { const active = link.dataset.nav === (route.startsWith('device/') ? 'devices' : route); link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (route === 'captures') await renderCaptures(); else if (route === 'settings') await renderSettings(); else if (route.startsWith('device/')) renderDevice(decodeURIComponent(route.slice(7))); else renderDevices();
}
async function refresh(force = false) {
  try {
    snapshot = await api('/api/devices');
    document.querySelector('#connection').innerHTML = '<span class="dot good"></span> Gateway connected';
    if (restarting) { restarting = false; settings = await api('/api/settings'); force = true; }
    const route = location.hash.slice(1) || 'devices';
    if (force) await render();
    else if (route === 'captures') await loadEvents();
    else if (route !== 'settings' && !main.contains(document.activeElement)) await render();
  } catch {
    document.querySelector('#connection').innerHTML = `<span class="dot bad"></span> ${restarting ? 'Restarting gateway…' : 'Gateway unavailable · reconnecting'}`;
  }
}
document.querySelector('#close-dialog').addEventListener('click', () => document.querySelector('#event-dialog').close());
window.addEventListener('hashchange', () => render().catch((error) => toast(error.message)));
refresh(true);
setInterval(() => refresh(), 4000);
