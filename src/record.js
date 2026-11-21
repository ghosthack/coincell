// Discovery tool for writing an adapter: npm run record -- https://your.bank/login
// Opens the browser, you log in and click through accounts / positions /
// transactions, then close the window. Every JSON call the site made is
// written to .data/recordings/ with VALUES REDACTED (only keys and types are
// kept), so the file shows the data's shape without containing your data.
import fs from 'node:fs';
import { openBrowser } from './browser.js';
import { dataPath } from './paths.js';

const url = process.argv[2];
if (!url) { console.log('Usage: npm run record -- <bank login url>'); process.exit(1); }

const shape = (v, depth = 0) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : [];
  if (typeof v === 'object') {
    if (depth > 8) return '{...}';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  if (typeof v === 'string') return /^-?[\d,.]+$/.test(v) ? 'numeric-string' : /^\d{4}-\d{2}-\d{2}/.test(v) ? 'date-string' : 'string';
  return typeof v;
};
const redactUrl = (u) => {
  const x = new URL(u);
  for (const k of [...x.searchParams.keys()]) x.searchParams.set(k, '_');
  return x.origin + x.pathname.replace(/[0-9a-f-]{16,}|\d{4,}/gi, ':id') + (x.search ? x.search : '');
};

const host = new URL(url).hostname;
const file = dataPath('recordings', `${host}-${Date.now()}.jsonl`);
const context = await openBrowser(`record-${host}`);
let count = 0;
context.on('response', async (res) => {
  const type = res.request().resourceType();
  if (type !== 'xhr' && type !== 'fetch') return;
  if (!(res.headers()['content-type'] ?? '').includes('json')) return;
  try {
    const body = await res.json();
    fs.appendFileSync(file, JSON.stringify({ method: res.request().method(), url: redactUrl(res.url()), status: res.status(), shape: shape(body) }) + '\n');
    count++;
  } catch { /* body unavailable */ }
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto(url);
console.log('Log in, open your accounts, positions and transactions pages, then close the browser window.');
await new Promise((resolve) => context.on('close', resolve));
console.log(`Recorded ${count} JSON responses (values redacted) to ${file}`);
