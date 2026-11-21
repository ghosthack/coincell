import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Demo mode (COINCELL_DEMO=1, or `npm run demo`) uses the made-up institutions in fakebanks/
// and keeps everything in its own folder, so demo numbers can never mix with real ones.
export const DEMO = process.env.COINCELL_DEMO === '1';
export const DATA_DIR = process.env.COINCELL_DATA || path.join(ROOT, DEMO ? '.data-demo' : '.data');
export const PUBLIC_DIR = path.join(ROOT, 'public');

export function dataPath(...parts) {
  const p = path.join(DATA_DIR, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  return p;
}

export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
