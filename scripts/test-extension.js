// End-to-end test of the browser extension against the made-up institutions:
//   1. start the demo (fake sites + dashboard) on an empty, throwaway data folder
//   2. open a browser with the extension loaded and log in to each fake site, as you would
//   3. press the extension's "Send all open sites" button
//   4. check what arrived against what the fake sites really hold (scripts/verify-fake.js)
//   5. record one site and check the recording holds its layout but none of its values
// Run with: npm run demo:test-extension   (the demo must not already be running)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coincell-ext-'));
const env = { ...process.env, COINCELL_DEMO: '1', COINCELL_DATA: path.join(tmp, 'data') };
const fail = (msg) => { console.error(`FAIL ${msg}`); process.exitCode = 1; };

const demo = spawn('node', ['scripts/demo.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { demo.stdout.on('data', (d) => /running at/.test(d) && resolve()); demo.on('exit', () => reject(new Error('the demo did not start; is it already running?'))); });

const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium', headless: process.env.COINCELL_SHOW !== '1',
  args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extension = new URL(worker.url()).host;
  const popup = async (query = '') => { const p = await context.newPage(); await p.goto(`chrome-extension://${extension}/popup.html${query}`); return p; };
  const results = (p) => p.locator('#results .result').evaluateAll((rows) => rows.map((r) => r.innerText.replace(/\n/g, ' ')));

  // Before logging in anywhere: the extension must say so, not send rubbish.
  const cold = await context.newPage(); await cold.goto('http://localhost:4701/login');
  let p = await popup(); await p.click('#send-all'); await p.waitForSelector('#results .result');
  const coldResult = (await results(p)).join(' | ');
  console.log('logged out  ->', coldResult);
  if (!/not logged in/i.test(coldResult)) fail('expected a "not logged in" message before login');
  await p.close(); await cold.close();

  // Log in to each site the way a person would.
  const logins = {
    4701: async (t) => { await t.fill('#username', 'demo'); await t.fill('#password', 'harbor-demo'); await t.click('#sign-in'); await t.fill('#code', await t.locator('#demo-code').innerText()); await t.click('#verify'); await t.waitForSelector('.acct'); },
    4702: async (t) => { await t.fill('#user-id', 'demo'); await t.fill('#pass', 'kestrel-demo'); await t.click('#login-form button'); await t.waitForSelector('#card-summary'); },
    4703: async (t) => { await t.fill('input[name="userId"]', 'demo'); await t.fill('input[name="passcode"]', 'copper-demo'); await t.click('button[type="submit"]'); await t.click('#not-now'); await t.waitForSelector('[data-field="current-balance"]'); },
    4704: async (t) => { await t.fill('#username', 'demo'); await t.click('#next'); await t.fill('#password', 'meridian-demo'); await t.click('#log-in'); await t.waitForSelector('#portfolio'); },
    4705: async (t) => { await t.fill('#user', 'demo'); await t.fill('#pw', 'lakeshore-demo'); await t.click('#signin'); await t.fill('#answer', await t.locator('#demo-answer').innerText()); await t.click('#continue'); await t.waitForSelector('#loan-summary'); },
  };
  const tabs = {};
  for (const [port, login] of Object.entries(logins)) {
    const t = tabs[port] = await context.newPage();
    await t.goto(`http://localhost:${port}/${port === '4705' ? 'signin' : 'login'}`);
    await login(t);
  }

  // One click sends everything.
  p = await popup(); await p.click('#send-all');
  await p.waitForFunction(() => document.querySelectorAll('#results .result').length >= 5, null, { timeout: 60_000 });
  const sent = await results(p);
  for (const line of sent) console.log('send all    ->', line);
  if (sent.length !== 5 || sent.some((l) => !l.startsWith('✓'))) fail('not every site was sent');
  await p.close();

  const verify = spawnSync('node', ['scripts/verify-fake.js'], { cwd: root, env, encoding: 'utf8' });
  const lines = verify.stdout.trim().split('\n');
  console.log(`data check  -> ${lines.filter((l) => l.startsWith('ok')).length} passed, ${lines.filter((l) => l.startsWith('FAIL')).length} failed: ${lines.at(-1)}`);
  if (verify.status !== 0) { fail('what the extension sent does not match the fake sites'); console.log(lines.filter((l) => l.startsWith('FAIL')).join('\n')); }

  // Recording: the layout of a site, none of its values.
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:4702/*' }))[0].id);
  p = await popup(`?tab=${tabId}`); await p.click('#record'); await p.waitForFunction(() => /Stop/.test(document.getElementById('record').textContent));
  await tabs[4702].reload(); await tabs[4702].waitForSelector('#card-summary'); await tabs[4702].waitForTimeout(3500);
  await p.click('#record'); await p.close();
  const file = path.join(env.COINCELL_DATA, 'recordings', 'localhost.extension.jsonl');
  const recorded = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const entries = recorded.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const data = entries.filter((e) => e.kind === 'data'), pages = entries.filter((e) => e.kind === 'page');
  console.log(`recording   -> ${data.length} data shapes (${[...new Set(data.map((e) => new URL(e.url).pathname))].join(', ')}), ${pages.length} page outline`);
  if (!data.some((e) => e.shape?.currentBalanceCents === 'number')) fail('the recording is missing the card summary shape');
  if (!pages.length) fail('the recording is missing the page outline');
  const leaked = ['GREENLEAF', 'BAKERY', 'Kestrel Cash', '0085'].filter((s) => recorded.includes(s));
  if (leaked.length) fail(`the recording contains real values: ${leaked.join(', ')}`); else console.log('recording   -> no merchant names, card name or card number in the file');
} finally {
  await context.close();
  demo.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(process.exitCode ? 'Extension test FAILED' : 'Extension test passed');
