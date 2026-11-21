import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.COINCELL_DATA || path.join(ROOT, '.data');
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
