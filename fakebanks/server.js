// Four fake institutions on four ports, each built differently on purpose so
// the scrapers have to cope with different login flows and data formats.
//   4701 Harborline Bank   server-rendered pages, password + emailed code, paged tables
//   4702 Kestrel Card      single-page app over a JSON API, "Load more" paging; a login form that only
//                          notices a password that was edited, as some carelessly built sites do
//   4703 Copperleaf Card   server-rendered, "remember this device" step, CSV download; a login form that
//                          refuses a passcode unless its field was clicked into and typed in
//   4704 Meridian Wealth   two-step login, JSON API behind the session cookie
//   4705 Lakeshore Home Loans  password + security question, payment history split into principal/interest/escrow
//   4706 Demo Mail         the inbox the fake sites email their codes to, with the same feed Gmail offers
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildWorld } from './world.js';

const TTL = 15 * 60_000;

// The made-up inbox. Sites "email" a code by adding to it; nothing is ever really sent.
const mailbox = [];
const deliver = (name, email, subject, text) => { mailbox.unshift({ id: randomUUID(), name, email, subject, text, at: new Date().toISOString() }); mailbox.length = Math.min(mailbox.length, 50); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mdy = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

function createSite({ port, name, color, handler }) {
  const sessions = new Map();
  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    // Browsers share cookies between ports of one host, so each site needs its own cookie name
    // or logging in to one would log you out of the others.
    const sid = new RegExp(`(?:^|; )sid${port}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1];
    let session = sessions.get(sid);
    if (session && session.exp < Date.now()) { sessions.delete(sid); session = undefined; }
    if (session) session.exp = Date.now() + TTL;
    let raw = '';
    for await (const c of req) raw += c;
    const send = (code, type, body, headers = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(body); };
    const ctx = {
      url, method: req.method, path: url.pathname, session, world: buildWorld(), send,
      form: Object.fromEntries(new URLSearchParams(raw)),
      body: () => { try { return JSON.parse(raw); } catch { return {}; } },
      start: (data) => { const id = randomUUID(); sessions.set(id, { ...data, exp: Date.now() + TTL }); res.setHeader('set-cookie', `sid${port}=${id}; HttpOnly; Path=/; SameSite=Lax`); },
      end: () => sessions.delete(sid),
      redirect: (to) => send(302, 'text/plain', '', { location: to }),
      json: (obj, code = 200) => send(code, 'application/json', JSON.stringify(obj)),
      html: (body, code = 200) => send(code, 'text/html; charset=utf-8', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)}</title><style>
        body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#1c1c1c;background:#f6f6f4}
        header{background:${color};color:#fff;padding:14px 28px;display:flex;justify-content:space-between;align-items:center}
        header b{font-size:19px} header a{color:#fff} .demo{background:#fff6d6;padding:6px 28px;font-size:13px}
        main{max-width:860px;margin:28px auto;padding:0 20px} .box{background:#fff;border:1px solid #ddd;border-radius:8px;padding:20px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee} .r{text-align:right}
        input{font:inherit;padding:8px;border:1px solid #bbb;border-radius:5px;display:block;margin:4px 0 14px;width:260px}
        button,.btn{font:inherit;background:${color};color:#fff;border:0;border-radius:5px;padding:9px 18px;cursor:pointer;text-decoration:none;display:inline-block}
        .err{color:#b00020} h2{margin-top:0} dl{display:grid;grid-template-columns:220px 1fr;gap:8px} dt{color:#666} dd{margin:0;font-weight:600}
      </style></head><body><header><b>${esc(name)}</b>${session ? '<a href="/logout">Sign out</a>' : ''}</header>
      <div class="demo">Demo site with made-up data. Nothing here is real.</div><main>${body}</main></body></html>`),
    };
    // What a site can tell about the browser visiting it: open /_browser on any of the fake sites.
    // The top half is what the server receives; the bottom half is what a script in the page can read.
    if (url.pathname === '/_browser') {
      const sent = ['user-agent', 'sec-ch-ua', 'sec-ch-ua-platform', 'accept-language'].map((h) => `<tr><td>${h}</td><td id="h-${h}">${esc(req.headers[h] ?? '(not sent)')}</td></tr>`).join('');
      return ctx.html(`<div class="box"><h2>What this site can see about your browser</h2><h3>Sent with the request</h3><table>${sent}</table>
        <h3>Readable by the page</h3><table id="seen"></table></div><script>
        const rows = { 'navigator.webdriver (true means driven by a program)': navigator.webdriver, 'navigator.userAgent': navigator.userAgent,
          'brands': (navigator.userAgentData?.brands ?? []).map((b) => b.brand + ' ' + b.version).join(', ') || '(none)', 'plugins': navigator.plugins.length,
          'languages': navigator.languages.join(', '), 'window size': innerWidth + ' x ' + innerHeight + ' of screen ' + screen.width + ' x ' + screen.height };
        for (const [k, v] of Object.entries(rows)) { const tr = document.createElement('tr'); for (const t of [k, String(v)]) { const td = document.createElement('td'); td.textContent = t; tr.append(td); } document.getElementById('seen').append(tr); }
        window.__seen = rows;</script>`);
    }
    try {
      if ((await handler(ctx)) === false) ctx.html('<h2>Page not found</h2>', 404);
    } catch (e) { send(500, 'text/plain', e.stack); }
  }).listen(port, '127.0.0.1', () => console.log(`${name.padEnd(18)} http://localhost:${port}`));
}

// ---------- 4701 Harborline Bank ----------
createSite({ port: 4701, name: 'Harborline Bank', color: '#0b4f6c', handler: (c) => {
  const { path, method, session, form, world } = c;
  const login = (err = '') => c.html(`<div class="box"><h2>Sign in to online banking</h2>${err && `<p class="err">${err}</p>`}
    <form method="post" action="/login"><label>Username<input id="username" name="username" autocomplete="username"></label>
    <label>Password<input id="password" name="password" type="password"></label><button id="sign-in">Sign in</button></form>
    <p>Demo login: <code>demo</code> / <code>harbor-demo</code></p></div>`, err ? 401 : 200);
  const verify = (err = '') => c.html(`<div class="box"><h2>Verify it's you</h2><p>We emailed a 6-digit code to d•••@mail.example.</p>${err && `<p class="err">${err}</p>`}
    <form method="post" action="/verify"><label>Security code<input id="code" name="code" inputmode="numeric"></label><button id="verify">Continue</button></form>
    <p>The demo inbox is at <a href="http://localhost:4706/" target="_blank">localhost:4706</a>.</p></div>`);
  if (path === '/logout') { c.end(); return c.redirect('/login'); }
  if (path === '/login') {
    if (method !== 'POST') return login();
    if (form.username !== 'demo' || form.password !== 'harbor-demo') return login('The username or password is incorrect.');
    const code = String(Math.floor(100000 + Math.random() * 900000));   // a new code for every sign-in, as real sites do
    deliver('Harborline Bank', 'alerts@harborline.example', 'Your Harborline security code', `Your security code is ${code}. It expires in 10 minutes. We will never ask you for it by phone.`);
    c.start({ stage: 'mfa', code }); return c.redirect('/verify');
  }
  if (path === '/verify') {
    if (!session) return c.redirect('/login');
    if (method !== 'POST') return verify();
    if (form.code !== session.code) return verify('That code is not right. Try again.');
    session.stage = 'ok'; return c.redirect('/accounts');
  }
  if (session?.stage !== 'ok') return c.redirect('/login');
  const accts = { chk: world.accounts.chk, sav: world.accounts.sav };
  if (path === '/' || path === '/accounts') {
    return c.html(`<h2>Your accounts</h2>` + Object.entries(accts).map(([id, a]) => `<section class="box acct" data-acct="${id}">
      <a href="/accounts/${id}"><h3>${esc(a.name)}</h3></a><span class="acct-num">Account ending in ${a.last4}</span>
      <div class="avail">Available balance <strong>${usd(a.bal)}</strong></div></section>`).join(''));
  }
  const m = /^\/accounts\/(chk|sav)$/.exec(path);
  if (m) {
    const a = accts[m[1]], per = 20, page = Math.max(1, Number(c.url.searchParams.get('page')) || 1);
    let run = a.bal;
    const rows = [...a.tx].reverse().map((t) => { const row = { ...t, run }; run = Math.round((run - t.amount) * 100) / 100; return row; });
    const slice = rows.slice((page - 1) * per, page * per);
    return c.html(`<p><a href="/accounts">‹ All accounts</a></p><div class="box"><h2>${esc(a.name)} ••${a.last4}</h2>
      <table id="activity"><thead><tr><th>Date</th><th>Description</th><th class="r">Withdrawals</th><th class="r">Deposits</th><th class="r">Balance</th></tr></thead><tbody>
      ${slice.map((t) => `<tr><td>${mdy(t.date)}</td><td>${esc(t.desc)}</td><td class="r">${t.amount < 0 ? usd(-t.amount) : ''}</td><td class="r">${t.amount > 0 ? usd(t.amount) : ''}</td><td class="r">${usd(t.run)}</td></tr>`).join('')}
      </tbody></table><p>${page > 1 ? `<a class="newer" href="?page=${page - 1}">‹ Newer</a> ` : ''}${page * per < rows.length ? `<a class="older" href="?page=${page + 1}">Older ›</a>` : ''}</p></div>`);
  }
  return false;
} });

// ---------- 4702 Kestrel Card (single-page app) ----------
createSite({ port: 4702, name: 'Kestrel Card', color: '#7a2e8e', handler: (c) => {
  const { path, method, session, world } = c;
  const k = world.accounts.kes;
  if (path === '/logout') { c.end(); return c.redirect('/login'); }
  if (path === '/api/session' && method === 'POST') {
    const b = c.body();
    if (b.username !== 'demo' || b.password !== 'kestrel-demo') return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
    c.start({}); return c.json({ ok: true });
  }
  if (path.startsWith('/api/')) {
    if (!session) return c.json({ error: 'UNAUTHENTICATED' }, 401);
    const toCents = (n) => Math.round(n * 100);
    if (path === '/api/v2/card/summary') {
      return c.json({ card: { productName: k.name, last4: k.last4 }, currentBalanceCents: toCents(-k.bal), creditLimitCents: toCents(k.limit),
        statementBalanceCents: toCents(k.statement.balance), remainingStatementBalanceCents: toCents(k.statement.remaining),
        minimumDueCents: k.statement.remaining > 0 ? Math.max(3500, toCents(k.statement.remaining * 0.02)) : 0,
        statementCloseDate: k.statement.closeDate, paymentDueDate: k.statement.dueDate, autopay: 'FULL_STATEMENT' });
    }
    if (path === '/api/v2/card/activity') { // card convention: purchases positive, payments negative
      const all = [...k.tx].reverse(), from = Number(c.url.searchParams.get('cursor')) || 0, per = 25;
      return c.json({ items: all.slice(from, from + per).map((t) => ({ id: t.id, postedAt: `${t.date}T12:00:00-05:00`, merchant: t.desc, amountCents: toCents(-t.amount), kind: t.type })),
        nextCursor: from + per < all.length ? String(from + per) : null });
    }
    return c.json({ error: 'NOT_FOUND' }, 404);
  }
  if (path === '/login') {
    return c.html(`<div class="box"><h2>Log in</h2><p class="err" id="error" hidden></p><form id="login-form">
      <label>User ID<input id="user-id" autocomplete="username"></label><label>Password<input id="pass" type="password"></label><button>Log in</button></form>
      <p>Demo login: <code>demo</code> / <code>kestrel-demo</code></p></div>
      <script>
        // Built carelessly on purpose: the form keeps its own copy of the fields, updated only when
        // the page is told of an edit, and treats a password as entered only after a second edit.
        const typed = { username: '', password: '' }; let edits = 0;
        document.getElementById('user-id').addEventListener('input', (e) => { typed.username = e.target.value; });
        document.getElementById('pass').addEventListener('input', (e) => { if (++edits > 1) typed.password = e.target.value; });
        document.getElementById('login-form').addEventListener('submit', async (e) => { e.preventDefault();
        const r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(typed) });
        if (r.ok) location.href = '/'; else { const el = document.getElementById('error'); el.hidden = false; el.textContent = 'We could not log you in.'; } });</script>`);
  }
  if (path === '/') {
    return c.html(`<div id="root"><p>Loading…</p></div><script>
      const $$ = (n) => '$' + (Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      (async () => {
        const r = await fetch('/api/v2/card/summary'); if (r.status === 401) return location.href = '/login';
        const s = await r.json();
        document.getElementById('root').innerHTML = '<div class="box" id="card-summary"><h2></h2><dl><dt>Current balance</dt><dd>' + $$(s.currentBalanceCents) + '</dd><dt>Statement balance left to pay</dt><dd>' + $$(s.remainingStatementBalanceCents) + '</dd><dt>Payment due</dt><dd>' + (s.paymentDueDate || 'None') + '</dd><dt>Available credit</dt><dd>' + $$(s.creditLimitCents - s.currentBalanceCents) + '</dd></dl></div><div class="box"><h2>Activity</h2><table><tbody id="rows"></tbody></table><p><button id="load-more">Load more</button></p></div>';
        document.querySelector('#card-summary h2').textContent = s.card.productName + ' ••' + s.card.last4;
        let cursor = '0'; const btn = document.getElementById('load-more');
        const more = async () => { btn.disabled = true; const p = await (await fetch('/api/v2/card/activity?cursor=' + cursor)).json();
          for (const t of p.items) { const tr = document.createElement('tr'); for (const v of [t.postedAt.slice(0, 10), t.merchant, (t.amountCents < 0 ? '-' : '') + $$(t.amountCents)]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); } document.getElementById('rows').append(tr); }
          cursor = p.nextCursor; btn.disabled = false; if (!cursor) btn.remove(); };
        btn.addEventListener('click', more); more();
      })();</script>`);
  }
  return false;
} });

// ---------- 4703 Copperleaf Card (server-rendered + CSV export) ----------
createSite({ port: 4703, name: 'Copperleaf Card Services', color: '#a8501a', handler: (c) => {
  const { path, method, session, form, world } = c;
  const k = world.accounts.cop;
  const login = (err = '') => c.html(`<div class="box"><h2>Cardmember sign on</h2>${err && `<p class="err">${err}</p>`}<form method="post" action="/login">
    <label>User ID<input name="userId"></label><label>Passcode<input name="passcode" type="password"></label><p class="err" id="sloppy" hidden>Please enter your passcode.</p><button type="submit">Sign on</button></form>
    <p>Demo login: <code>demo</code> / <code>copper-demo</code></p></div>
    <script>
      // Built carelessly on purpose: instead of looking at what is in the passcode field, the page
      // decides whether one was entered by whether the field was clicked into and a key was pressed in it.
      const field = document.querySelector('input[name="passcode"]'), seen = { focus: false, key: false };
      field.addEventListener('focus', () => { seen.focus = true; });
      field.addEventListener('keyup', () => { seen.key = true; });
      field.form.addEventListener('submit', (e) => { if (!seen.focus || !seen.key) { e.preventDefault(); document.getElementById('sloppy').hidden = false; } });
    </script>`, err ? 401 : 200);
  if (path === '/logout') { c.end(); return c.redirect('/login'); }
  if (path === '/login') {
    if (method !== 'POST') return login();
    if (form.userId !== 'demo' || form.passcode !== 'copper-demo') return login('Sign on failed.');
    c.start({ stage: 'remember' }); return c.redirect('/remember');
  }
  if (!session) return c.redirect('/login');
  if (path === '/remember') {
    if (method === 'POST') { session.stage = 'ok'; return c.redirect('/overview'); }
    return c.html(`<div class="box"><h2>Remember this device?</h2><p>We won't ask extra security questions next time.</p>
      <form method="post" action="/remember"><button name="choice" value="yes">Remember this device</button> <button name="choice" value="no" id="not-now">Not now</button></form></div>`);
  }
  if (session.stage !== 'ok') return c.redirect('/remember');
  if (path === '/' || path === '/overview') {
    const recent = [...k.tx].reverse().slice(0, 8);
    return c.html(`<div class="box"><h2>${esc(k.name)} ending in ${k.last4}</h2><dl>
      <dt>Current balance</dt><dd data-field="current-balance">${usd(-k.bal)}</dd>
      <dt>Last statement balance</dt><dd data-field="statement-balance">${usd(k.statement.balance)}</dd>
      <dt>Remaining statement balance</dt><dd data-field="remaining-balance">${usd(k.statement.remaining)}</dd>
      <dt>Payment due date</dt><dd data-field="due-date">${k.statement.dueDate ? mdy(k.statement.dueDate) : 'No payment due'}</dd>
      <dt>Credit line</dt><dd data-field="credit-line">${usd(k.limit)}</dd></dl></div>
      <div class="box"><h2>Recent activity</h2><table><tbody>${recent.map((t) => `<tr><td>${mdy(t.date)}</td><td>${esc(t.desc)}</td><td class="r">${usd(-t.amount)}</td></tr>`).join('')}</tbody></table>
      <p><a class="btn" id="download-csv" href="/activity.csv">Download all activity (CSV)</a></p></div>`);
  }
  if (path === '/activity.csv') { // card convention again: sales positive, payments negative
    const q = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ['Transaction Date,Posted Date,Description,Amount,Type,Reference',
      ...[...k.tx].reverse().map((t) => [mdy(t.date), mdy(t.date), q(t.desc), (-t.amount).toFixed(2), t.type, t.id].join(','))];
    return c.send(200, 'text/csv', lines.join('\r\n') + '\r\n', { 'content-disposition': 'attachment; filename="copperleaf-activity.csv"' });
  }
  return false;
} });

// ---------- 4704 Meridian Wealth (two-step login + JSON API) ----------
createSite({ port: 4704, name: 'Meridian Wealth', color: '#1d6b45', handler: (c) => {
  const { path, method, session, form, world } = c;
  const accts = { brk: world.accounts.brk, ira: world.accounts.ira, k401: world.accounts.k401 };
  if (path === '/logout') { c.end(); return c.redirect('/login'); }
  if (path === '/login') {
    if (method === 'POST') { c.start({ user: form.username, stage: 'password' }); return c.redirect('/login/password'); }
    return c.html(`<div class="box"><h2>Log in</h2><form method="post" action="/login"><label>Username<input name="username" id="username"></label><button id="next">Next</button></form>
      <p>Demo login: <code>demo</code> / <code>meridian-demo</code></p></div>`);
  }
  if (path === '/login/password') {
    if (!session) return c.redirect('/login');
    const page = (err = '') => c.html(`<div class="box"><h2>Welcome back</h2>${err && `<p class="err">${err}</p>`}<form method="post" action="/login/password">
      <label>Password<input name="password" id="password" type="password"></label><button id="log-in">Log in</button></form></div>`, err ? 401 : 200);
    if (method !== 'POST') return page();
    if (session.user !== 'demo' || form.password !== 'meridian-demo') return page('Your username or password is incorrect.');
    session.stage = 'ok'; return c.redirect('/portfolio');
  }
  const authed = session?.stage === 'ok';
  if (path.startsWith('/api/')) {
    if (!authed) return c.json({ message: 'Not signed in' }, 401);
    if (path === '/api/accounts') return c.json(Object.entries(accts).map(([id, a]) => ({ id, name: a.name, kind: a.kind, number: a.number, totalValue: a.total, cashBalance: a.cash })));
    const m = /^\/api\/accounts\/(brk|ira|k401)\/(positions|history|activity)$/.exec(path);
    if (!m) return c.json({ message: 'Not found' }, 404);
    const a = accts[m[1]];
    if (m[2] === 'positions') return c.json([...a.positions, { ticker: 'CASH', description: 'Cash & sweep', shares: a.cash, lastPrice: 1, marketValue: a.cash, costBasis: null }]);
    if (m[2] === 'history') return c.json(a.hist.slice(-(Number(c.url.searchParams.get('days')) || 90)));
    return c.json([...a.tx].reverse().map((t) => ({ id: t.id, date: t.date, type: t.type, description: t.desc, amount: t.amount })));
  }
  if (!authed) return c.redirect('/login');
  if (path === '/' || path === '/portfolio') {
    return c.html(`<h2 id="portfolio">Portfolio</h2>` + Object.values(accts).map((a) => `<div class="box"><h3>${esc(a.name)} <small>${a.number}</small></h3>
      <p>Total value <strong>${usd(a.total)}</strong></p><table><thead><tr><th>Symbol</th><th>Description</th><th class="r">Shares</th><th class="r">Price</th><th class="r">Value</th></tr></thead><tbody>
      ${a.positions.map((p) => `<tr><td>${p.ticker}</td><td>${esc(p.description)}</td><td class="r">${p.shares}</td><td class="r">${usd(p.lastPrice)}</td><td class="r">${usd(p.marketValue)}</td></tr>`).join('')}
      </tbody></table></div>`).join(''));
  }
  return false;
} });

// ---------- 4705 Lakeshore Home Loans (mortgage servicer) ----------
createSite({ port: 4705, name: 'Lakeshore Home Loans', color: '#34495e', handler: (c) => {
  const { path, method, session, form, world } = c;
  const m = world.accounts.mtg;
  const login = (err = '') => c.html(`<div class="box"><h2>Sign in to your loan</h2>${err && `<p class="err">${err}</p>`}<form method="post" action="/signin">
    <label>Username<input name="user" id="user"></label><label>Password<input name="pw" id="pw" type="password"></label><button id="signin">Sign in</button></form>
    <p>Demo login: <code>demo</code> / <code>lakeshore-demo</code></p></div>`, err ? 401 : 200);
  const question = (err = '') => c.html(`<div class="box"><h2>Security question</h2>${err && `<p class="err">${err}</p>`}<form method="post" action="/challenge">
    <label><span id="question">What was the name of your first pet?</span><input name="answer" id="answer"></label><button id="continue">Continue</button></form>
    <p>Demo answer: <code id="demo-answer">biscuit</code></p></div>`);
  if (path === '/logout') { c.end(); return c.redirect('/signin'); }
  if (path === '/signin') {
    if (method !== 'POST') return login();
    if (form.user !== 'demo' || form.pw !== 'lakeshore-demo') return login('We did not recognise that username and password.');
    c.start({ stage: 'challenge' }); return c.redirect('/challenge');
  }
  if (!session) return c.redirect('/signin');
  if (path === '/challenge') {
    if (method !== 'POST') return question();
    if ((form.answer ?? '').trim().toLowerCase() !== 'biscuit') return question('That answer does not match our records.');
    session.stage = 'ok'; return c.redirect('/loan');
  }
  if (session.stage !== 'ok') return c.redirect('/challenge');
  if (path === '/' || path === '/loan') {
    return c.html(`<div class="box" id="loan-summary"><h2>${esc(m.name)}</h2><dl>
      <dt>Loan number</dt><dd data-field="loan-number">${m.number}</dd>
      <dt>Unpaid principal balance</dt><dd data-field="principal-balance">${usd(-m.bal)}</dd>
      <dt>Interest rate</dt><dd data-field="rate">${(m.rate * 100).toFixed(3)}%</dd>
      <dt>Next payment due</dt><dd data-field="next-due">${mdy(m.nextDue)}</dd>
      <dt>Payment amount</dt><dd data-field="payment-amount">${usd(m.pi + m.escrow)}</dd>
      <dt>Escrow balance</dt><dd data-field="escrow-balance">${usd(m.escrowBal)}</dd></dl></div>
      <div class="box"><h2>Payment history</h2><table id="payments"><thead><tr><th>Date</th><th>Reference</th><th class="r">Total paid</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Escrow</th><th class="r">Balance after</th></tr></thead><tbody>
      ${[...m.tx].reverse().map((t) => `<tr><td>${mdy(t.date)}</td><td>${t.id}</td><td class="r">${usd(t.total)}</td><td class="r">${usd(t.principal)}</td><td class="r">${usd(t.interest)}</td><td class="r">${usd(t.escrow)}</td><td class="r">${usd(t.balanceAfter)}</td></tr>`).join('')}
      </tbody></table></div>`);
  }
  return false;
} });

// ---------- 4706 Demo Mail (where the fake sites email their codes) ----------
// /mail/u/0/feed/atom has the shape of Gmail's own feed of unread mail, which is what the
// extension reads to find an emailed code.
createSite({ port: 4706, name: 'Demo Mail', color: '#5f6368', handler: (c) => {
  if (c.path === '/mail/u/0/feed/atom') {
    return c.send(200, 'application/atom+xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://purl.org/atom/ns#" version="0.3"><title>Gmail - Inbox for demo@mail.example</title><fullcount>${mailbox.length}</fullcount>${
      mailbox.map((m) => `<entry><title>${esc(m.subject)}</title><summary>${esc(m.text)}</summary><modified>${m.at}</modified><issued>${m.at}</issued><id>${m.id}</id><author><name>${esc(m.name)}</name><email>${esc(m.email)}</email></author></entry>`).join('')}</feed>`);
  }
  if (c.path === '/') {
    return c.html(`<h2>Inbox for demo@mail.example</h2><div class="box"><table><tr><th>From</th><th>Message</th><th>Received</th></tr>${
      mailbox.map((m) => `<tr><td>${esc(m.name)}</td><td><b>${esc(m.subject)}</b><br>${esc(m.text)}</td><td>${esc(m.at.slice(11, 19))} UTC</td></tr>`).join('') || '<tr><td colspan="3">No mail yet. Sign in to Harborline Bank and its code arrives here.</td></tr>'}</table></div>`);
  }
  return false;
} });
