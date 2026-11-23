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
    4701: async (t) => { await t.fill('#username', 'demo'); await t.fill('#password', 'harbor-demo'); await t.click('#sign-in'); await t.fill('#code', (await (await fetch('http://localhost:4706/mail/u/0/feed/atom')).text()).match(/security code is (\d{6})/)[1]); await t.click('#verify'); await t.waitForSelector('.acct'); },
    4702: async (t) => { await t.fill('#user-id', 'demo'); await t.locator('#pass').pressSequentially('kestrel-demo'); await t.click('#login-form button'); await t.waitForSelector('#card-summary'); },
    4703: async (t) => { await t.fill('input[name="userId"]', 'demo'); await t.locator('input[name="passcode"]').pressSequentially('copper-demo'); await t.click('button[type="submit"]'); await t.click('#not-now'); await t.waitForSelector('[data-field="current-balance"]'); },
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

  // The bridge: the dashboard asks, the extension does it, in background tabs.
  const dash = (p, body) => fetch(`http://localhost:4690${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' }, body: JSON.stringify(body) } : undefined).then((r) => r.json());
  const until = async (what, test, ms = 90_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) { const st = await dash('/api/status'); if (test(st)) return st; } fail(`timed out waiting for ${what}`); return dash('/api/status'); };
  const states = (st) => st.institutions.filter((i) => i.readBy === 'extension').map((i) => `${i.id} ${i.progress?.state ?? 'idle'}`).join(', ');
  await until('the extension to connect', (st) => st.extension, 45_000);
  await until('earlier syncs to settle', (s) => !s.active, 60_000); await new Promise((r) => setTimeout(r, 1500));
  const tabsBefore = context.pages().length;
  await dash('/api/refresh', { bank: 'all' });
  let st = await until('refresh all', (s) => !s.active && s.institutions.filter((i) => i.readBy === 'extension').every((i) => i.progress));
  console.log('refresh all ->', states(st));
  if (st.institutions.filter((i) => i.readBy === 'extension').length !== 5 || st.institutions.some((i) => i.readBy === 'extension' && i.progress?.state !== 'done')) fail('refresh all should have read all five sites through the extension');
  if (context.pages().length !== tabsBefore) fail(`refresh all should close the background tabs it opens (${tabsBefore} before, ${context.pages().length} after)`);

  // Logged out of one site: it is reported as needing a login, with the login page left open ...
  await tabs[4703].goto('http://localhost:4703/logout');
  await dash('/api/refresh', { bank: 'copperleaf' });
  st = await until('the logged-out site to report', (s) => !s.active && ['needs-login', 'done', 'failed'].includes(s.institutions.find((i) => i.id === 'copperleaf').progress?.state));
  console.log('logged out  ->', states(st));
  if (st.institutions.find((i) => i.id === 'copperleaf').progress.state !== 'needs-login') fail('a logged-out site should be reported as needing a login');
  if (tabs[4703].isClosed()) fail('a tab the user opened must never be closed');
  if (!context.pages().some((pg) => pg !== tabs[4703] && /localhost:4703\/login/.test(pg.url()))) fail('the login page should be left open for the user');
  // ... and logging in is the cue to read it, with nothing pressed.
  await tabs[4703].goto('http://localhost:4703/login'); await logins[4703](tabs[4703]);
  st = await until('the sync that follows a login', (s) => s.institutions.find((i) => i.id === 'copperleaf').progress?.state === 'done', 60_000);
  console.log('after login ->', states(st));

  // Saved logins: with every site logged out, a refresh signs in by itself where it can.
  //   Harborline emails a code, Kestrel's form only notices an edited password, Copperleaf asks to
  //   remember the device, Meridian asks for the username and password on separate pages, and
  //   Lakeshore asks a security question, which nothing here can answer.
  const passwords = { harborline: 'harbor-demo', kestrel: 'kestrel-demo', copperleaf: 'copper-demo', meridian: 'meridian-demo', lakeshore: 'lakeshore-demo' };
  const one = (s, id) => s.institutions.find((i) => i.id === id);
  const settledAll = (s) => !s.active && s.institutions.filter((i) => i.readBy === 'extension').every((i) => ['done', 'needs-login', 'failed'].includes(i.progress?.state));
  for (const [site, password] of Object.entries(passwords)) await dash('/api/logins', { site, username: 'demo', password });
  // First the proof that the two careless sites are careless: with the password only set, and the
  // add-and-remove step left out, Kestrel (wants an edit) and Copperleaf (wants focus and a key press) refuse it.
  await worker.evaluate(() => chrome.storage.local.set({ plainFill: true }));
  for (const [id, port] of [['kestrel', 4702], ['copperleaf', 4703]]) {
    await tabs[port].goto(`http://localhost:${port}/logout`);
    await dash('/api/refresh', { bank: id });
    await until('the first progress', (s) => s.active, 10_000);
    st = await until('the plain fill to be refused', (s) => !s.active && ['done', 'needs-login', 'failed'].includes(one(s, id).progress?.state), 90_000);
    console.log(`plain fill  -> ${id} ${one(st, id).progress.state}: ${one(st, id).progress.message}`);
    if (one(st, id).progress.state !== 'needs-login') fail(`${id} should refuse a password that was only set, never edited`);
  }
  await worker.evaluate(() => chrome.storage.local.remove(['plainFill', 'rejected']));
  for (const port of Object.keys(logins)) await tabs[port].goto(`http://localhost:${port}/logout`);
  await new Promise((r) => setTimeout(r, 1000));
  await dash('/api/refresh', { bank: 'all' });
  await until('the first progress', (s) => s.active, 10_000);
  st = await until('the refresh that signs in', settledAll, 150_000);
  console.log('signs in    ->', states(st));
  for (const id of ['harborline', 'kestrel', 'copperleaf', 'meridian']) if (one(st, id).progress.state !== 'done') fail(`${id} should have been signed in to and read: ${one(st, id).progress.message}`);
  if (one(st, 'lakeshore').progress.state !== 'needs-login' || !/cannot answer/.test(one(st, 'lakeshore').progress.message)) fail(`a security question should be left to the user: ${one(st, 'lakeshore').progress.message}`);
  else console.log('signs in    -> lakeshore:', one(st, 'lakeshore').progress.message);

  // A login the site turns down is tried once, never twice.
  await dash('/api/logins', { site: 'harborline', username: 'demo', password: 'not-the-password' });
  await tabs[4701].goto('http://localhost:4701/logout');
  for (const expected of [/did not let the saved login through/, /not tried again/]) {
    await dash('/api/refresh', { bank: 'harborline' });
    await until('the first progress', (s) => s.active, 10_000);
    st = await until('the refused login', (s) => !s.active && one(s, 'harborline').progress?.state !== 'done', 90_000);
    console.log('wrong login ->', one(st, 'harborline').progress.message);
    if (!expected.test(one(st, 'harborline').progress.message)) fail('a refused login should be reported, and not tried a second time');
  }
  // The password leaves coincell only for the extension: not in the status, and not without the header pages cannot send.
  const statusText = JSON.stringify(await dash('/api/status'));
  if (Object.values(passwords).some((pw) => statusText.includes(pw)) || statusText.includes('not-the-password')) fail('the status must never contain a password');
  if ((await fetch('http://localhost:4690/ext/login?site=kestrel')).status !== 403) fail('a saved login must not be readable by a web page');
  else console.log('saved login -> not in the status, and refused to anything that is not the extension');
  await dash('/api/logins', { site: 'harborline', remove: true });
  await tabs[4701].goto('http://localhost:4701/login'); await logins[4701](tabs[4701]);

  // A site that changed: send Meridian again with an account, the holdings and the transactions gone.
  const thin = await (await fetch('http://localhost:4690/api/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' },
    body: JSON.stringify({ bank: 'meridian', snapshot: { accounts: [{ id: 'Z31-553318', name: 'Individual Brokerage', type: 'investment', balance: 36000 }] } }) })).json();
  for (const w of thin.warnings ?? []) console.log('thin import ->', w);
  if ((thin.warnings ?? []).length < 3) fail('a much thinner import should have raised warnings about missing accounts, holdings and transactions');

  // Recording: the layout of a site, none of its values.
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:4702/*' }))[0].id);
  p = await popup(`?tab=${tabId}`); if (!(await p.locator('#pause').isDisabled())) fail('Pause should be greyed out while nothing is recording');
  await p.click('#record'); await p.waitForSelector('#pause:not([disabled])');
  await tabs[4702].goto('http://localhost:4702/logout'); await logins[4702](tabs[4702]);   // a login while recording: the password must not be kept
  await tabs[4702].waitForTimeout(3500);
  await p.click('#pause'); await p.waitForSelector('#pause[disabled]'); await p.close();
  const file = path.join(env.COINCELL_DATA, 'recordings', 'localhost.extension.jsonl');
  const recorded = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const entries = recorded.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const data = entries.filter((e) => e.kind === 'data'), pages = entries.filter((e) => e.kind === 'page');
  console.log(`recording   -> ${data.length} data shapes (${[...new Set(data.map((e) => new URL(e.url).pathname))].join(', ')}), ${pages.length} page outline`);
  if (!data.some((e) => e.shape?.currentBalanceCents === 'number')) fail('the recording is missing the card summary shape');
  if (!pages.length) fail('the recording is missing the page outline');
  const login = data.find((e) => e.method === 'POST' && /\/api\/session$/.test(e.url));
  console.log(`recording   -> login request kept as ${JSON.stringify(login?.sent)} with headers ${JSON.stringify(login?.sentHeaders)}`);
  if (login?.sent?.password !== 'aaaaaaa-aaaa') fail('the recording should hold the login request with its values masked');
  const leaked = ['GREENLEAF', 'BAKERY', 'Kestrel Cash', '0085', 'kestrel-demo'].filter((s) => recorded.includes(s));
  if (leaked.length) fail(`the recording contains real values: ${leaked.join(', ')}`); else console.log('recording   -> no merchant names, card name, card number or password in the file');
} finally {
  await context.close();
  demo.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(process.exitCode ? 'Extension test FAILED' : 'Extension test passed');
