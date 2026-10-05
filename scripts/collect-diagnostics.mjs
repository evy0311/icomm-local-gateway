import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || ""}\n[command failed: ${error.message}]`;
  }
}

function redact(value) {
  return value
    .replace(/\bAC(?=[A-Z0-9]*\d)[A-Z0-9]{10,}\b/gi, "<DSN>")
    .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, "<MAC>")
    .replace(/\/devices\/\d+\//g, "/devices/<DEVICE_ID>/")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<IP>")
    .replace(/\/Users\/[^/\s]+/g, "<HOME>")
    .replace(/\b[0-9a-f]{48,}\b/gi, "<LONG_HEX_REDACTED>")
    .replace(/(authorization[^\n:]*:\s*)[^\n]+/gi, "$1<REDACTED>");
}

let stateSummary = "Gateway API was unavailable.";
try {
  const port = process.env.ICOMM_DASHBOARD_PORT || "8788";
  const state = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json());
  stateSummary = JSON.stringify({
    version: state.version,
    lastDecodeError: state.lastDecodeError,
    latest: state.latest && {
      receivedAt: state.latest.receivedAt,
      setpoint: state.latest.decoded?.setpoint,
      mode: state.latest.decoded?.mode,
      segmentBytes: state.latest.decoded?.segmentBytes,
      confidence: state.latest.decoded?.decodedConfidence,
    },
    pendingCommand: state.pendingCommand && { kind: state.pendingCommand.kind, status: state.pendingCommand.status, target: state.pendingCommand.target },
    lastCommand: state.lastCommand && { kind: state.lastCommand.kind, status: state.lastCommand.status, target: state.lastCommand.target },
    ans: state.ans,
  }, null, 2);
} catch (error) {
  stateSummary += ` ${error.message}`;
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const output = `iCOMM Local Gateway diagnostics\nGenerated: ${new Date().toISOString()}\nPlatform: ${process.platform} ${process.arch}\nNode: ${process.version}\n\n== State summary ==\n${stateSummary}\n\n== Containers ==\n${run("docker", ["compose", "ps"])}\n\n== Recent logs ==\n${run("docker", ["compose", "logs", "--no-color", "--tail", "300"])}\n\n== Tests ==\n${run("node", ["--test"])}\n`;
const filename = `diagnostics-${stamp}.txt`;
await writeFile(filename, redact(output), { mode: 0o600 });
console.log(`Created ${filename}`);
console.log("Review it manually before attaching it to a public issue. Never attach .env, certificate keys, or unredacted packet captures.");
