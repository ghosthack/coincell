// Helpers shared by every site script. Runs inside the page you are logged in to, so its
// requests carry your session exactly as the page's own requests do.
(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** "$1,234.56", "(1,234.56)", "-$12.00", "$-12.00" -> number */
  function parseMoney(text) {
    if (typeof text === 'number') return text;
    const s = String(text ?? '').trim();
    if (!s) return null;
    const negative = /^\(.*\)$/.test(s) || /^[^\d]*[-−–]/.test(s) || /[-−–]$/.test(s) || /\bDR\b/i.test(s);
    let digits = s.replace(/[^\d.,]/g, '');
    if (/,\d{2}$/.test(digits) && !/\.\d{2}$/.test(digits)) digits = digits.replace(/\./g, '').replace(',', '.');
    else digits = digits.replace(/,/g, '');
    const n = Number(digits);
    return Number.isFinite(n) && digits ? (negative ? -n : n) : null;
  }
  const mdyToIso = (s) => { const [m, d, y] = s.trim().split('/'); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; };

  /** Past end-of-day balances, rebuilt by walking the transactions back from today's balance. */
  function balanceHistory(balance, transactions, since) {
    if (!transactions.length && !since) return [];
    const byDay = new Map();
    for (const t of transactions) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
    const first = [...byDay.keys(), ...(since ? [since] : [])].sort()[0];
    const out = [];
    let bal = balance;
    for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
      const date = today(d);
      if (date < first) break;
      out.push({ date, balance: Math.round(bal * 100) / 100 });
      bal -= byDay.get(date) ?? 0;
    }
    return out.reverse();
  }

  function parseCsv(text, headerHas) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const at = headerHas ? rows.findIndex((r) => r.some((c) => c.trim() === headerHas)) : 0;
    if (at < 0) return [];
    const head = rows[at].map((h) => h.trim());
    return rows.slice(at + 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  const LOGIN_FIRST = 'You are not logged in to this site. Log in, then press the button again.';
  /** Fetch one of the site's pages as a document. `loginPages` matches the paths the site sends you to when logged out. */
  async function page(url, loginPages = /login|signin|sign-in/i) {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401 || res.status === 403 || loginPages.test(new URL(res.url).pathname)) throw new Error(LOGIN_FIRST);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }
  async function request(url, as) {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) throw new Error(LOGIN_FIRST);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res[as]();
  }
  const text = (el) => (el?.textContent ?? '').trim();

  globalThis.coincell = { today, parseMoney, mdyToIso, balanceHistory, parseCsv, page, text, json: (url) => request(url, 'json'), download: (url) => request(url, 'text') };
})();
