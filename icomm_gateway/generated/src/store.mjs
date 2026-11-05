import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function loadStore(path) {
  let saved;
  try { saved = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved && saved.version !== 1) throw new Error('Unsupported state version');
  const state = saved ?? { version: 1, instance: randomUUID(), deviceId: null, latest: null,
    vacationDays: 7, pending: null, lastCommand: null, lastError: null };
  const save = async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  // Never replay a command after an interruption: delivery may have happened before a crash.
  if (state.pending) {
    state.lastCommand = { ...state.pending, status: 'interrupted', finishedAt: new Date().toISOString() };
    state.pending = null;
  }
  await save();
  return { state, save };
}
