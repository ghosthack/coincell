import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR, DEMO } from './paths.js';
import { getAccounts, getNetWorth, getNetWorthByType, getHoldings, getTransactions, getCashflow } from './db.js';
import { BANKS } from './banks/index.js';
import { runSync, state } from './sync.js';
import { getInsights } from './insights.js';

const PORT = Number(process.env.PORT) || (DEMO ? 4690 : 4680); // demo and real can run side by side
const HOST = '127.0.0.1'; // never expose financial data beyond this machine
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
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
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => console.log(`coincell${DEMO ? ' (demo data)' : ''} running at http://localhost:${PORT}`));
