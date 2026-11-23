import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR, DEMO, dataPath } from './paths.js';
import { getAccounts, getNetWorth, getNetWorthByType, getHistoryNote, getHoldings, getTransactions, getCashflow, saveSnapshot, linkTransfers, removeAccounts, bankSummary, recordImport, getImports } from './db.js';
import { poll, command, extension, active, progressBy, setProgress, nextRun } from './bridge.js';
import { compareWithLastTime } from './checks.js';
import { BANKS } from './banks/index.js';
import { runSync, state } from './sync.js';
import { getInsights } from './insights.js';
import { saveLogin, removeLogin, getLogin, loginSavedAt, storeName, getSettings, saveSettings, codesInbox, siteInbox, saveSiteInbox } from './logins.js';

const PORT = Number(process.env.PORT) || (DEMO ? 4690 : 4680); // demo and real can run side by side
const HOST = '127.0.0.1'; // never expose financial data beyond this machine
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 2e7) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  try {
    // Reject other hostnames (DNS rebinding) and cross-site writes (CSRF).
    const host = req.headers.host ?? '';
    if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) return json(res, 403, { error: 'Forbidden host' });
    const url = new URL(req.url, `http://${host}`);
    const route = `${req.method} ${url.pathname}`;

    if (req.method === 'POST' && req.headers['x-coincell'] !== '1') return json(res, 403, { error: 'Forbidden' });

    switch (route) {
      case 'GET /api/overview': {
        const accounts = getAccounts();
        const names = Object.fromEntries(BANKS.map((b) => [b.id, b.name]));
        const sum = (...types) => accounts.filter((a) => types.includes(a.type)).reduce((s, a) => s + a.balance, 0);
        return json(res, 200, {
          accounts: accounts.map((a) => ({ ...a, bank_name: names[a.bank] ?? a.bank })),
          netWorth: accounts.reduce((s, a) => s + a.balance, 0),
          breakdown: { cash: sum('cash'), investments: sum('investment'), retirement: sum('retirement'), property: sum('property'), cards: sum('credit'), loans: sum('loan') },
          banks: BANKS.map(({ id, name, needsBrowser }) => ({ id, name, needsBrowser })),
          sync: state,
          demo: DEMO,
          history: getHistoryNote(),
        });
      }
      case 'GET /api/networth': return json(res, 200, getNetWorth());
      case 'GET /api/networth-types': return json(res, 200, getNetWorthByType());
      case 'GET /api/holdings': return json(res, 200, getHoldings());
      case 'GET /api/cashflow': return json(res, 200, getCashflow());
      case 'GET /api/insights': return json(res, 200, getInsights());
      case 'GET /api/transactions':
        return json(res, 200, getTransactions({ account: url.searchParams.get('account'), limit: url.searchParams.get('limit') }));
      case 'GET /api/sync': return json(res, 200, state);
      case 'POST /api/sync': {
        const { bank } = await readBody(req);
        if (bank !== 'all' && !BANKS.some((b) => b.id === bank)) return json(res, 400, { error: 'Unknown bank' });
        if (state.running) return json(res, 409, { error: 'A sync is already running' });
        runSync(bank).catch(() => {}); // result is reported through /api/sync
        return json(res, 202, { started: true });
      }
    }

    if (req.method === 'GET') {
      const name = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
      const file = path.join(PUBLIC_DIR, name);
      if (TYPES[path.extname(name)] && fs.existsSync(file)) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(name)], 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'" });
        return fs.createReadStream(file).pipe(res);
      }
    }
    // ---- the bridge (see bridge.js) ----
    if (url.pathname.startsWith('/ext/') && req.headers['x-coincell'] !== '1') return json(res, 403, { error: 'Forbidden' });   // pages cannot send this header
    if (route === 'GET /ext/poll') return poll(res, url.searchParams.get('sites')?.split(',').filter(Boolean), url.searchParams.get('signin')?.split(',').filter(Boolean), (cmd) => json(res, 200, cmd));
    if (route === 'POST /ext/progress') {
      const { site, state: s, message, warnings } = await readBody(req);
      if (BANKS.some((b) => b.id === site)) setProgress(site, s, message, warnings);
      return json(res, 200, { ok: true });
    }
    // The extension asks for a saved login when it is on that institution's own sign-in page.
    // This is the only route that returns a password.
    if (route === 'GET /ext/login') {
      const site = url.searchParams.get('site');
      if (!BANKS.some((b) => b.id === site)) return json(res, 400, { error: 'Unknown institution' });
      const login = getLogin(site);
      return json(res, 200, login ? { ...login, inbox: codesInbox(site) } : { saved: false });
    }
    if (route === 'POST /api/logins') {
      const { site, username, password, inbox, remove } = await readBody(req);
      if (!BANKS.some((b) => b.id === site)) return json(res, 400, { error: 'Unknown institution' });
      if (inbox && !/^[^@\s]+@[^@\s]+$/.test(inbox)) return json(res, 400, { error: 'That inbox does not look like an email address' });
      // The inbox can be changed by itself, without typing the password again.
      if (remove) removeLogin(site); else if (username || password || !getLogin(site)) saveLogin(site, username, password);
      if (inbox !== undefined) saveSiteInbox(site, remove ? '' : inbox);
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /api/settings') {
      const { codesInbox: address } = await readBody(req);
      if (address && !/^[^@\s]+@[^@\s]+$/.test(address)) return json(res, 400, { error: 'That does not look like an email address' });
      saveSettings({ codesInbox: String(address ?? '').trim() });
      return json(res, 200, { ok: true });
    }
    if (route === 'GET /api/status') {
      const { asOf, last } = getImports(), ext = extension();
      return json(res, 200, { extension: ext.connected, active: active() || state.running, loginStore: storeName, codesInbox: DEMO ? codesInbox().address : getSettings().codesInbox ?? '',
        institutions: BANKS.map((b) => ({ id: b.id, name: b.name, asOf: asOf.get(b.id) ?? null, last: last.get(b.id) ?? null, progress: progressBy[b.id] ?? null, canSignIn: ext.signIn.includes(b.id), loginSavedAt: ext.signIn.includes(b.id) ? loginSavedAt(b.id) : null, inbox: DEMO ? '' : siteInbox(b.id),
          readBy: ext.sites.includes(b.id) || b.viaExtension ? 'extension' : b.needsBrowser ? 'browser' : 'file' })) });
    }
    if (route === 'POST /api/refresh') {
      // Each institution goes the way it can: through the extension in your own Chrome where the
      // extension knows the site, otherwise read directly from here.
      const { bank } = await readBody(req);
      const wanted = bank === 'all' || !bank ? BANKS : BANKS.filter((b) => b.id === bank);
      if (!wanted.length) return json(res, 400, { error: 'Unknown institution' });
      const ext = extension(), run = nextRun(), viaExtension = [], direct = [];
      for (const b of wanted) {
        if (ext.connected && ext.sites.includes(b.id)) { viaExtension.push(b); setProgress(b.id, 'queued', 'Waiting for the browser extension'); }
        else if (b.viaExtension) setProgress(b.id, 'failed', ext.connected ? 'The browser extension does not know this site.' : 'The browser extension is not connected. Open Chrome with the coincell extension loaded.');
        else { direct.push(b); setProgress(b.id, 'queued', 'Waiting'); }
      }
      if (viaExtension.length) command({ type: 'refresh', run, sites: viaExtension.map((b) => b.id) });
      (async () => {   // the ones read from here, one at a time
        for (const b of direct) {
          setProgress(b.id, 'working', 'Reading');
          try { await runSync(b.id); setProgress(b.id, 'done', state.last?.message ?? 'Done'); } catch (e) { setProgress(b.id, 'failed', e.message.split('\n')[0]); }
        }
      })();
      return json(res, 202, { run, viaExtension: viaExtension.map((b) => b.id), direct: direct.map((b) => b.id) });
    }

    // ---- from the browser extension (it sends the x-coincell header checked above) ----
    if (route === 'POST /api/import') {
      const { bank, snapshot } = await readBody(req);
      const known = BANKS.find((b) => b.id === bank);
      if (!known) return json(res, 400, { error: `This coincell does not have an institution called "${bank}"` });
      if (!Array.isArray(snapshot?.accounts)) return json(res, 400, { error: 'Nothing to import' });
      const warnings = compareWithLastTime(bankSummary(bank, snapshot).filter((b) => !(snapshot.drop ?? []).includes(b.id)), snapshot);
      saveSnapshot(bank, snapshot);
      const removed = Array.isArray(snapshot.drop) ? removeAccounts(bank, snapshot.drop) : 0;
      if (removed) console.log(`[${bank}] removed ${removed} accounts that belong to other institutions`);
      const linked = linkTransfers();
      state.last = { bank, ok: !warnings.length, at: new Date().toISOString(), message: `${known.name}: ${snapshot.accounts.length} account${snapshot.accounts.length === 1 ? '' : 's'} received${warnings.length ? `. ${warnings.join(' ')}` : ''}` };
      for (const w of warnings) console.log(`[${bank}] WARNING ${w}`);
      recordImport(bank, true, `${snapshot.accounts.length} account${snapshot.accounts.length === 1 ? '' : 's'} read`, warnings);
      console.log(`[${bank}] ${snapshot.accounts.length} accounts from the extension, ${linked} new transfers matched`);
      return json(res, 200, { accounts: snapshot.accounts.length, linked, warnings });
    }
    if (route === 'POST /api/recordings') {
      const { host, entry } = await readBody(req);
      const safe = String(host ?? '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
      if (!safe || !entry) return json(res, 400, { error: 'Nothing to record' });
      fs.appendFileSync(dataPath('recordings', `${safe}.extension.jsonl`), JSON.stringify(entry) + '\n');
      if (entry.kind === 'send') console.log(`[${entry.site}] send ${entry.ok ? 'ok' : 'FAILED'}: ${entry.message}`);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => console.log(`coincell${DEMO ? ' (demo data)' : ''} running at http://localhost:${PORT}`));
