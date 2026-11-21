'use strict';
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
let currency = 'USD';
let series = [];
let rangeDays = Number(localStorage.getItem('range') ?? 90);
let seriesByType = [];
let noDataHint = 'No data yet.';
let nwMode = localStorage.getItem('nwMode') ?? 'total';

const money = (n, opts = {}) => n == null ? '–' : new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }).format(n);
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
const qty = (n) => n == null ? '–' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(n);
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => parseDate(s).toLocaleDateString(undefined, opts);
const api = async (path, init) => {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
};

// el('td', { class: 'num' }, 'text') - text is always set as text, never HTML (bank text is untrusted).
function el(tag, attrs = {}, ...children) {
  const node = tag === 'svg' || attrs.svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k !== 'svg' && v != null) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null));
  return node;
}
const s = (tag, attrs, ...children) => el(tag, { ...attrs, svg: true }, ...children);

function table(target, columns, rows, emptyText) {
  target.replaceChildren();
  if (!rows.length) return target.append(el('div', { class: 'empty' }, emptyText));
  const head = el('tr', {}, ...columns.map((c) => el('th', { class: c.num ? 'num' : null }, c.label)));
  const body = rows.map((r) => r.group
    ? el('tr', { class: 'group' }, el('td', { colspan: columns.length }, r.group))
    : el('tr', {}, ...columns.map((c) => el('td', { class: [c.num && 'num', c.cls].filter(Boolean).join(' ') || null }, ...[c.get(r)].flat()))));
  target.append(el('table', {}, el('thead', {}, head), el('tbody', {}, ...body)));
}

// ---------- net worth chart: one series, so no legend; hover gives exact values ----------
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function drawChart() {
  const box = $('chart');
  const tip = $('tip');
  box.querySelector('svg')?.remove();
  box.querySelector('.empty')?.remove();
  tip.style.display = 'none';

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - rangeDays);
  const inRange = (arr) => (rangeDays ? arr.filter((p) => parseDate(p.date) >= cutoff) : arr);
  const pts = inRange(series);
  $('nw-legend').hidden = nwMode !== 'type';
  if (nwMode === 'type' && pts.length) return window.drawNetWorthByType(box, inRange(seriesByType), $('nw-legend'));
  if (!pts.length) return box.append(el('div', { class: 'empty' }, series.length ? 'No snapshots in this range.' : noDataHint));

  const W = box.clientWidth, H = box.clientHeight;
  if (!W) return; // tab is hidden
  const m = { t: 10, r: 14, b: 24, l: 14 };
  const compact = (v) => new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const vals = pts.map((p) => p.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  m.l = 14 + Math.max(...ticks.map((t) => compact(t).length)) * 6.4;
  const t0 = parseDate(pts[0].date).getTime(), t1 = parseDate(pts.at(-1).date).getTime();
  const x = (p) => t1 === t0 ? (m.l + W - m.r) / 2 : m.l + ((parseDate(p.date).getTime() - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (H - m.t - m.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Net worth from ${fmtDate(pts[0].date)} to ${fmtDate(pts.at(-1).date)}` });
  for (const t of ticks) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }),
      s('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, compact(t)));
  }
  const nx = Math.min(pts.length, Math.max(2, Math.floor((W - m.l - m.r) / 130)));
  const shown = new Set();
  for (let i = 0; i < nx; i++) {
    const p = pts[Math.round((i / Math.max(nx - 1, 1)) * (pts.length - 1))];
    if (shown.has(p.date)) continue;
    shown.add(p.date);
    svg.append(s('text', { x: x(p), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' }, fmtDate(p.date, { month: 'short', day: 'numeric' })));
  }
  if (pts.length > 1) {
    svg.append(s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(''),
      fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  const cross = s('line', { y1: m.t, y2: H - m.b, stroke: 'var(--text-muted)', 'stroke-width': 1, visibility: 'hidden' });
  const dot = s('circle', { r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2 });
  const place = (p) => { dot.setAttribute('cx', x(p)); dot.setAttribute('cy', y(p.value)); };
  place(pts.at(-1));
  svg.append(cross, dot);
  box.prepend(svg);

  const hover = (ev) => {
    const px = ev.clientX - box.getBoundingClientRect().left;
    const p = pts.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a);
    place(p);
    cross.setAttribute('x1', x(p)); cross.setAttribute('x2', x(p)); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(el('span', { class: 'muted' }, fmtDate(p.date)), el('b', {}, money(p.value)));
    tip.style.display = 'block';
    const left = x(p) + 12 + tip.offsetWidth > W ? x(p) - 12 - tip.offsetWidth : x(p) + 12;
    tip.style.transform = `translate(${left}px, ${Math.max(0, y(p.value) - tip.offsetHeight - 8)}px)`;
  };
  svg.addEventListener('pointermove', hover);
  svg.addEventListener('pointerdown', hover);
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); place(pts.at(-1)); });
}

function setRange(days) {
  rangeDays = days;
  localStorage.setItem('range', days);
  for (const b of $('range').children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
  drawChart();
  // Change over the selected range, shown under the headline number.
  const cut = new Date(); cut.setDate(cut.getDate() - (days || 1e5));
  const inRange = series.filter((p) => parseDate(p.date) >= cut);
  if (inRange.length > 1) {
    const d = inRange.at(-1).value - inRange[0].value;
    const pct = inRange[0].value ? ` (${(Math.abs(d / inRange[0].value) * 100).toFixed(1)}%)` : '';
    $('change').textContent = `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${signed(d)}${pct} since ${fmtDate(inRange[0].date)}`;
  } else $('change').textContent = ' ';
}

// ---------- data ----------
const TYPE = { cash: 'Cash', investment: 'Investment', retirement: 'Retirement', property: 'Property', credit: 'Credit card', loan: 'Mortgage / loan' };
const daysUntil = (iso) => Math.round((parseDate(iso) - new Date(new Date().toDateString())) / 86_400_000);
const monthName = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

async function loadTransactions() {
  const account = $('txn-account').value;
  const rows = await api('/api/transactions?limit=100' + (account ? `&account=${encodeURIComponent(account)}` : ''));
  const describe = (r) => {
    if (!r.other_account) return r.category && r.account_type !== 'cash' && r.account_type !== 'credit' ? [r.description, el('span', { class: 'tag' }, r.category)] : r.description;
    const types = [r.account_type, r.other_type];
    const kind = types.includes('credit') ? 'Card payment' : types.includes('loan') ? 'Loan payment' : 'Transfer';
    return [r.description, el('span', { class: 'tag' }, `${kind} ${r.amount < 0 ? '→' : '←'} ${r.other_account}`)];
  };
  table($('transactions'), [
    { label: 'Date', get: (r) => fmtDate(r.date), cls: 'muted' },
    { label: 'Description', get: describe, cls: 'wrap' },
    { label: 'Account', get: (r) => r.account_name, cls: 'muted' },
    { label: 'Amount', num: true, get: (r) => signed(r.amount) },
  ], rows, 'No transactions yet.');
}

async function load() {
  const [overview, networth, holdings, cashflow, byType] = await Promise.all([api('/api/overview'), api('/api/networth'), api('/api/holdings'), api('/api/cashflow'), api('/api/networth-types')]);
  seriesByType = byType;
  const accounts = overview.accounts;
  currency = accounts[0]?.currency ?? 'USD';
  series = networth;
  $('networth').textContent = accounts.length ? money(overview.netWorth) : '–';
  $('demo-tag').hidden = !overview.demo;
  noDataHint = overview.demo ? 'No data yet. Press “Sync now”.' : overview.banks.some((b) => b.needsBrowser) ? 'No data yet. Press “Sync now”.' : 'No institutions connected yet. Run “npm run demo” to explore with made-up data.';

  if (!$('bank').options.length) {
    $('bank').append(el('option', { value: 'all' }, 'All institutions'), ...overview.banks.map((b) => el('option', { value: b.id }, b.name)));
    $('bank').value = localStorage.getItem('bank') ?? 'all';
    if (!$('bank').value) $('bank').value = 'all';
  }

  const count = (...types) => accounts.filter((a) => types.includes(a.type)).length;
  const plural = (n) => `${n} account${n === 1 ? '' : 's'}`;
  const b = overview.breakdown;
  $('tiles').replaceChildren(...[
    ['Cash', b.cash, plural(count('cash'))],
    ['Investments', b.investments, plural(count('investment'))],
    ['Retirement', b.retirement, plural(count('retirement'))],
    ['Property', b.property, count('property') ? 'your own estimate' : 'none entered'],
    ['Owed on cards', -b.cards, plural(count('credit'))],
    ['Owed on mortgage and loans', -b.loans, plural(count('loan'))],
  ].map(([label, value, sub]) => el('div', { class: 'card tile' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, money(value)), el('div', { class: 'sub' }, sub))));

  const grouped = [];
  for (const a of accounts) {
    if (grouped.at(-1)?.bank !== a.bank) grouped.push({ group: a.bank_name, bank: a.bank });
    grouped.push(a);
  }
  table($('accounts'), [
    { label: 'Account', get: (r) => r.name },
    { label: 'Number', get: (r) => (r.mask ? `••${r.mask}` : ''), cls: 'muted' },
    { label: 'Type', get: (r) => TYPE[r.type] ?? r.type, cls: 'muted' },
    { label: 'As of', get: (r) => fmtDate(r.as_of), cls: 'muted' },
    { label: 'Balance', num: true, get: (r) => money(r.balance) },
  ], grouped, 'No accounts yet.');

  const due = accounts.filter((a) => a.due_amount > 0 && a.due_date).sort((x, y) => x.due_date.localeCompare(y.due_date));
  table($('payments'), [
    { label: 'Account', get: (r) => `${r.name} ••${r.mask ?? ''}` },
    { label: 'Institution', get: (r) => r.bank_name, cls: 'muted' },
    { label: 'Due', get: (r) => { const d = daysUntil(r.due_date); return `${fmtDate(r.due_date, { month: 'short', day: 'numeric' })} (${d < 0 ? `${-d} days overdue` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`})`; } },
    { label: 'Amount to pay', num: true, get: (r) => money(r.due_amount) },
    { label: 'Total owed', num: true, get: (r) => money(-r.balance), cls: 'muted' },
  ], due, 'Nothing due.');
  const totalDue = due.reduce((s, a) => s + a.due_amount, 0);
  $('payments-foot').textContent = due.length
    ? `${money(totalDue)} due in total. Cash on hand is ${money(b.cash)}, leaving ${money(b.cash - totalDue)} after these payments.` : '';

  table($('cashflow'), [
    { label: 'Month', get: (r) => monthName(r.month) + (r.month === networth.at(-1)?.date.slice(0, 7) ? ' (so far)' : '') },
    { label: 'Income', num: true, get: (r) => money(r.income) },
    { label: 'Spending', num: true, get: (r) => money(r.spending) },
    { label: 'Left over', num: true, get: (r) => signed(r.income - r.spending) },
    { label: 'Mortgage principal', num: true, get: (r) => money(r.loanPrincipal), cls: 'muted' },
    { label: 'Moved to investments', num: true, get: (r) => money(r.invested), cls: 'muted' },
    { label: 'Paid to cards', num: true, get: (r) => money(r.cardPayments), cls: 'muted' },
  ], cashflow, 'No transactions yet.');

  const total = holdings.reduce((a, h) => a + h.value, 0);
  $('holdings-total').textContent = holdings.length ? `${money(total)} total` : '';
  table($('holdings'), [
    { label: 'Symbol', get: (r) => r.symbol },
    { label: 'Name', get: (r) => r.name ?? '', cls: 'wrap muted' },
    { label: 'Account', get: (r) => r.account_name, cls: 'muted' },
    { label: 'Quantity', num: true, get: (r) => qty(r.quantity) },
    { label: 'Price', num: true, get: (r) => money(r.price) },
    { label: 'Value', num: true, get: (r) => money(r.value) },
    { label: 'Share', num: true, get: (r) => (total ? `${((r.value / total) * 100).toFixed(1)}%` : '–'), cls: 'muted' },
    { label: 'Gain / loss', num: true, get: (r) => (r.cost_basis == null ? '–' : `${r.value >= r.cost_basis ? '▲' : '▼'} ${signed(r.value - r.cost_basis)}`) },
  ], holdings, 'No securities holdings yet.');

  const sel = $('txn-account'), keep = sel.value;
  sel.replaceChildren(el('option', { value: '' }, 'All accounts'), ...accounts.map((a) => el('option', { value: a.id }, `${a.name} (${a.bank_name})`)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';

  setRange(rangeDays);
  await loadTransactions();
  if (window.loadInsights) await window.loadInsights();
  return overview.sync;
}

// ---------- sync ----------
function showStatus(st) {
  const box = $('status');
  $('sync').disabled = st.running;
  if (st.running) return box.replaceChildren(`Syncing… ${st.log.at(-1) ?? ''}`);
  if (!st.last) return box.replaceChildren();
  box.replaceChildren(el('span', { class: `mark ${st.last.ok ? 'ok' : 'bad'}` }, st.last.ok ? '✓ ' : '✕ '),
    `${st.last.ok ? '' : 'Sync failed: '}${st.last.message} · ${new Date(st.last.at).toLocaleTimeString()}`);
}

async function poll() {
  const st = await api('/api/sync');
  showStatus(st);
  if (st.running) return setTimeout(poll, 1000);
  await load();
}

$('sync').addEventListener('click', async () => {
  localStorage.setItem('bank', $('bank').value);
  $('sync').disabled = true;
  try {
    await api('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' }, body: JSON.stringify({ bank: $('bank').value }) });
    poll();
  } catch (e) {
    $('status').replaceChildren(el('span', { class: 'mark bad' }, '✕ '), e.message);
    $('sync').disabled = false;
  }
});
$('range').addEventListener('click', (e) => { if (e.target.dataset.days != null) setRange(Number(e.target.dataset.days)); });
$('txn-account').addEventListener('change', loadTransactions);
const setMode = (mode) => { nwMode = mode; localStorage.setItem('nwMode', mode); for (const b of $('nw-mode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); drawChart(); };
$('nw-mode').addEventListener('click', (e) => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
for (const b of $('nw-mode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === nwMode));
new ResizeObserver(() => drawChart()).observe($('chart'));

load().then((st) => { showStatus(st); if (st.running) poll(); })
  .catch((e) => $('status').replaceChildren(el('span', { class: 'mark bad' }, '✕ '), e.message));
