import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateCloudHost } from './cloud.mjs';

export async function loadSettings(path, defaults) {
  let saved = {};
  try { saved = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const validate = (values) => {
    if (!['local', 'bridge'].includes(values.mode)) throw new Error('Choose local or bridge mode');
    if (!['redacted', 'full'].includes(values.captureMode)) throw new Error('Choose redacted or full capture');
    if (values.cloudHost) validateCloudHost(values.cloudHost);
    if (values.mode === 'bridge' && !values.cloudHost) throw new Error('Bridge mode requires the device-service hostname');
    return values;
  };
  const current = validate({ ...defaults, ...saved });
  return { current, async save(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some((key) => !['mode', 'captureMode', 'cloudHost'].includes(key))) throw new Error('Unsupported setting');
    const next = validate({ ...current, ...patch });
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    return next;
  }, async reset() { await unlink(path).catch((error) => { if (error.code !== 'ENOENT') throw error; }); } };
}
