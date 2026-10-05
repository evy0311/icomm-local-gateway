import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { readFile, writeFile, rename } from "node:fs/promises";
import { decodeSuperBlock, extractDatapoint } from "./decoder.mjs";
import { emptyCommandsXml, encodeSetpointCommand, encodeStandardCommand, encodeVacationCommand, propertyCommandXml } from "./protocol.mjs";

const HEATER_PORT = Number(process.env.ICOMM_HEATER_PORT || 8080);
const ADMIN_PORT = Number(process.env.ICOMM_ADMIN_PORT || 8081);
const DNS_PORT = Number(process.env.ICOMM_DNS_PORT || 5353);
const ANS_PORT = Number(process.env.ICOMM_ANS_PORT || 55055);
const LOCAL_IP = process.env.ICOMM_LOCAL_IP || "192.168.2.1";
const DATA_FILE = process.env.ICOMM_DATA_FILE || "/data/state.json";
const CONFIGURED_DEVICE_ID = process.env.ICOMM_DEVICE_ID?.trim() || null;
const DNS_CAPTURE_ALL = !/^(0|false|no)$/i.test(process.env.ICOMM_DNS_CAPTURE_ALL || "true");
const DEBUG_PACKETS = /^(1|true|yes)$/i.test(process.env.ICOMM_DEBUG_PACKETS || "false");
const MAX_BODY = 4 * 1024 * 1024;
const dashboard = await readFile(new URL("./dashboard.html", import.meta.url));

const state = {
  version: 2,
  gatewayMode: "local",
  deviceId: CONFIGURED_DEVICE_ID,
  latest: null,
  lastDecodeError: null,
  events: [],
  pendingCommand: null,
  lastCommand: null,
  commandHistory: [],
  desired: null,
  ans: { listeningPort: ANS_PORT, packetsReceived: 0, lastDevicePacketAt: null, lastDevicePacketLength: null },
};

try {
  const saved = JSON.parse(await readFile(DATA_FILE, "utf8"));
  state.deviceId = CONFIGURED_DEVICE_ID || saved.deviceId || null;
  for (const key of ["latest", "lastDecodeError", "events", "pendingCommand", "lastCommand", "commandHistory", "desired"]) {
    if (saved[key] !== undefined) state[key] = saved[key];
  }
  state.ans = {
    ...state.ans,
    packetsReceived: saved.ans?.packetsReceived || 0,
    lastDevicePacketAt: saved.ans?.lastDevicePacketAt || null,
    lastDevicePacketLength: saved.ans?.lastDevicePacketLength || null,
  };
} catch (error) {
  if (error?.code !== "ENOENT") console.error(`Could not restore state: ${error.message}`);
}
state.version = 2;
state.gatewayMode = "local";

let persistChain = Promise.resolve();
function persist() {
  persistChain = persistChain.catch(() => undefined).then(async () => {
    const temporary = `${DATA_FILE}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, DATA_FILE);
  });
  return persistChain;
}

function observeDeviceId(path) {
  const observed = path?.match(/\/devices\/(\d+)\//)?.[1];
  if (!observed) return;
  if (!state.deviceId) {
    state.deviceId = observed;
    console.log(`${new Date().toISOString()} learned heater device ID from request path`);
    void persist().catch((error) => console.error(`Could not save device ID: ${error.message}`));
  } else if (state.deviceId !== observed) {
    console.warn(`${new Date().toISOString()} ignored request for a second device ID`);
  }
}

function pendingCommandMatchesLatest() {
  const command = state.pendingCommand;
  const decoded = state.latest?.decoded;
  if (!command || !decoded) return false;
  if (command.kind === "setpoint") return decoded.setpoint.fahrenheit === command.target.fahrenheit;
  if (command.kind === "mode") {
    return decoded.mode.name === command.target.mode &&
      (command.target.mode === "STANDARD" || decoded.mode.vacationDays === command.target.days);
  }
  return false;
}

function confirmPendingCommand(confirmedAt, confirmationBasis) {
  const command = state.pendingCommand;
  if (!command) return;
  command.status = "confirmed";
  command.confirmedAt = confirmedAt;
  command.confirmationBasis = confirmationBasis;
  state.lastCommand = command;
  state.commandHistory.push(command);
  state.commandHistory = state.commandHistory.slice(-50);
  state.pendingCommand = null;
  state.desired = null;
}

if (state.pendingCommand?.status === "acknowledged" && pendingCommandMatchesLatest()) {
  confirmPendingCommand(state.pendingCommand.acknowledgedAt || new Date().toISOString(), "recovered-acknowledgement-and-existing-matching-telemetry");
  await persist();
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value, null, 2));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY) throw new Error("Request body exceeds 4 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function localReply(request) {
  const path = request.url || "/";
  observeDeviceId(path);
  if (request.method === "POST" && path.includes("/properties/setBlockParameter/datapoints.xml")) {
    if (state.pendingCommand) {
      state.pendingCommand.status = "acknowledged";
      state.pendingCommand.acknowledgedAt = new Date().toISOString();
      const acknowledgedAt = state.pendingCommand.acknowledgedAt;
      if (pendingCommandMatchesLatest()) confirmPendingCommand(acknowledgedAt, "heater-acknowledgement-and-existing-matching-telemetry");
      await persist();
      console.log(`${acknowledgedAt} local command acknowledged by heater`);
    }
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(0) };
  }
  if (request.method === "POST" && path.includes("/datapoints.xml")) {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(0) };
  }
  if (request.method === "GET" && path === "/ping") {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(0) };
  }
  if (request.method === "GET" && path.includes("/commands.xml")) {
    if (state.pendingCommand?.status === "queued") {
      const command = state.pendingCommand;
      command.status = "delivered";
      command.deliveredAt = new Date().toISOString();
      await persist();
      console.log(`${command.deliveredAt} delivered local ${command.property} command: ${command.value}`);
      return { statusCode: 200, headers: { "content-type": "application/xml; charset=utf-8" }, body: Buffer.from(propertyCommandXml(command.property, command.value)) };
    }
    return { statusCode: 200, headers: { "content-type": "application/xml; charset=utf-8" }, body: Buffer.from(emptyCommandsXml()) };
  }
  return { statusCode: 404, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ error: "No local handler for this route" })) };
}

function recordTelemetry(request, body) {
  if (request.method !== "POST" || !request.url?.includes("/properties/superBlockDyn1/datapoints.xml")) return;
  const value = extractDatapoint(body.toString("utf8"));
  if (!value) return;
  const receivedAt = new Date().toISOString();
  let decoded;
  try {
    decoded = decodeSuperBlock(value);
  } catch (error) {
    const segments = value.split(",").map((part) => /^[0-9a-f]+$/i.test(part) && part.length % 2 === 0 ? part.length / 2 : null);
    state.lastDecodeError = { receivedAt, message: error.message, segmentBytes: segments };
    void persist().catch((persistError) => console.error(`Could not save decode error: ${persistError.message}`));
    console.warn(`${receivedAt} unsupported telemetry layout: ${error.message}; segment bytes=${segments.join(",")}`);
    return;
  }
  state.lastDecodeError = null;
  state.latest = { receivedAt, decoded };
  state.events.push({ receivedAt, path: "/devices/<device>/properties/superBlockDyn1/datapoints.xml", setpoint: decoded.setpoint, mode: decoded.mode });
  state.events = state.events.slice(-200);
  if (pendingCommandMatchesLatest()) confirmPendingCommand(receivedAt, "matching-heater-telemetry");
  void persist().catch((error) => console.error(`Could not save state: ${error.message}`));
  console.log(`${receivedAt} telemetry setpoint=${decoded.setpoint.fahrenheit}F mode=${decoded.mode.name}`);
}

const heaterServer = createServer(async (request, response) => {
  try {
    const body = await readBody(request);
    recordTelemetry(request, body);
    const result = await localReply(request);
    response.writeHead(result.statusCode, { ...result.headers, "content-length": String(result.body.length) });
    response.end(result.body);
    const safePath = request.url?.replace(/\/devices\/\d+\//, "/devices/<device>/");
    console.log(`${new Date().toISOString()} local ${request.method} ${safePath} -> ${result.statusCode}`);
  } catch (error) {
    console.error(`${new Date().toISOString()} gateway error: ${error.message}`);
    json(response, 500, { error: "Local gateway error" });
  }
});

function queueCommand(command) {
  const queuedAt = new Date().toISOString();
  state.desired = { ...command.target, queuedAt };
  state.pendingCommand = { id: `${command.kind}-${Date.now()}`, kind: command.kind, property: "setBlockParameter", value: command.value, target: command.target, status: "queued", queuedAt };
  return persist();
}

const adminServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": dashboard.length, "cache-control": "no-store" });
      response.end(dashboard);
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, state);
    if (request.method === "POST" && url.pathname === "/api/cancel-command") {
      if (!state.pendingCommand) return json(response, 409, { error: "There is no pending command" });
      state.lastCommand = { ...state.pendingCommand, status: "cancelled", cancelledAt: new Date().toISOString() };
      state.commandHistory.push(state.lastCommand);
      state.commandHistory = state.commandHistory.slice(-50);
      state.pendingCommand = null;
      state.desired = null;
      await persist();
      return json(response, 200, { cancelled: true });
    }
    if (request.method === "POST" && url.pathname === "/api/desired-setpoint") {
      const input = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      if (!Number.isInteger(input.fahrenheit) || input.fahrenheit < 95 || input.fahrenheit > 130) return json(response, 400, { error: "fahrenheit must be a whole number from 95 to 130" });
      if (!state.latest) return json(response, 409, { error: "No compatible heater telemetry has been decoded yet; local commands remain disabled" });
      if (state.pendingCommand) return json(response, 409, { error: "A local command is already awaiting heater confirmation", pendingCommand: state.pendingCommand });
      await queueCommand({ kind: "setpoint", value: encodeSetpointCommand(input.fahrenheit), target: { fahrenheit: input.fahrenheit } });
      return json(response, 202, { queued: true, message: "Queued locally; it will be delivered when the heater next requests commands.", command: state.pendingCommand });
    }
    if (request.method === "POST" && url.pathname === "/api/desired-mode") {
      const input = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      if (!["STANDARD", "VACATION"].includes(input.mode)) return json(response, 400, { error: "mode must be STANDARD or VACATION" });
      if (!state.latest) return json(response, 409, { error: "No compatible heater telemetry has been decoded yet; local commands remain disabled" });
      if (state.pendingCommand) return json(response, 409, { error: "A local command is already awaiting heater confirmation", pendingCommand: state.pendingCommand });
      const target = input.mode === "VACATION" ? { mode: "VACATION", days: input.days } : { mode: "STANDARD", days: 0 };
      const value = input.mode === "VACATION" ? encodeVacationCommand(input.days) : encodeStandardCommand();
      await queueCommand({ kind: "mode", value, target });
      return json(response, 202, { queued: true, message: "Queued locally; it will be delivered when the heater next requests commands.", command: state.pendingCommand });
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
});

heaterServer.listen(HEATER_PORT, "0.0.0.0", () => console.log(`Heater gateway listening on ${HEATER_PORT}`));
adminServer.listen(ADMIN_PORT, "0.0.0.0", () => console.log(`Local API listening on ${ADMIN_PORT}`));

function dnsQuestionEnd(packet) {
  let offset = 12;
  while (offset < packet.length && packet[offset] !== 0) offset += packet[offset] + 1;
  return offset + 5;
}

function dnsName(packet) {
  const labels = [];
  let offset = 12;
  while (offset < packet.length && packet[offset] !== 0) {
    const length = packet[offset++];
    labels.push(packet.subarray(offset, offset + length).toString("ascii"));
    offset += length;
  }
  return labels.join(".");
}

function localAddressBytes() {
  const octets = LOCAL_IP.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error(`Invalid ICOMM_LOCAL_IP: ${LOCAL_IP}`);
  return Buffer.from(octets);
}

function dnsResponse(packet) {
  if (packet.length < 17 || packet.readUInt16BE(4) !== 1) return undefined;
  const end = dnsQuestionEnd(packet);
  if (end > packet.length) return undefined;
  const questionType = packet.readUInt16BE(end - 4);
  const hasAnswer = DNS_CAPTURE_ALL && questionType === 1;
  const header = Buffer.alloc(12);
  packet.copy(header, 0, 0, 2);
  header.writeUInt16BE(hasAnswer ? 0x8180 : 0x8183, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(hasAnswer ? 1 : 0, 6);
  if (!hasAnswer) return Buffer.concat([header, packet.subarray(12, end)]);
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0);
  answer.writeUInt16BE(1, 2);
  answer.writeUInt16BE(1, 4);
  answer.writeUInt32BE(30, 6);
  answer.writeUInt16BE(4, 10);
  localAddressBytes().copy(answer, 12);
  return Buffer.concat([header, packet.subarray(12, end), answer]);
}

const dnsServer = createSocket("udp4");
dnsServer.on("message", (packet, remote) => {
  try {
    const reply = dnsResponse(packet);
    if (reply) {
      console.log(`${new Date().toISOString()} DNS ${dnsName(packet) || "<invalid>"}`);
      dnsServer.send(reply, remote.port, remote.address);
    }
  } catch (error) {
    console.error(`DNS error: ${error.message}`);
  }
});
dnsServer.bind(DNS_PORT, "0.0.0.0", () => console.log(`Local DNS listening on UDP ${DNS_PORT}`));

const ansServer = createSocket("udp4");
ansServer.on("message", (packet) => {
  if (packet.length < 8) return;
  state.ans.packetsReceived += 1;
  state.ans.lastDevicePacketAt = new Date().toISOString();
  state.ans.lastDevicePacketLength = packet.length;
  const suffix = DEBUG_PACKETS ? `: ${packet.toString("hex")}` : "";
  console.log(`${state.ans.lastDevicePacketAt} ANS device packet (${packet.length} bytes)${suffix}`);
  void persist().catch((error) => console.error(`Could not save ANS state: ${error.message}`));
});
ansServer.on("error", (error) => console.error(`ANS listener error: ${error.message}`));
ansServer.bind(ANS_PORT, "0.0.0.0", () => console.log(`Local ANS sink listening on UDP ${ANS_PORT}; outbound relay is disabled`));
