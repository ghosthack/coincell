'use strict';
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
let currency = 'USD';
let series = [];
let rangeDays = Number(localStorage.getItem('range') ?? 90);
let seriesByType = [];
let noDataHint = 'No data yet.';
let nwMode = localStorage.getItem('nwMode') ?? 'total';

// Figures are shown one of two ways: as percentages and shares (the default), with amounts kept
// out of sight, or as amounts. The switch is beside the tabs and is remembered.
let showAmounts = localStorage.getItem('figures') === 'amounts';
const HIDDEN = '•••';
// Amounts written into a sentence (a suggestion, a bank's own description of a payment) are hidden the same way.
const hush = (text) => (showAmounts ? text : String(text ?? '').replace(/[$€£]\s?\d[\d,]*(\.\d+)?[KMB]?\b/g, HIDDEN));
const money = (n, opts = {}) => n == null ? '–' : !showAmounts ? HIDDEN : new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }).format(n);
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
// A figure followed, in small type, by what share of some whole it is. Where there is no sensible whole, just the figure.
const share = (part, whole, digits = 1) => (whole && part != null && Number.isFinite(part / whole) ? el('span', { class: 'pc' }, `${((Math.abs(part) / Math.abs(whole)) * 100).toFixed(digits)}%`) : null);
// With amounts: the amount, then its share in small type. Without: the share alone, keeping any sign or arrow.
const withShare = (text, part, whole) => {
  if (showAmounts) return [text, share(part, whole)];
  const pc = whole && part != null && Number.isFinite(part / whole) ? `${((Math.abs(part) / Math.abs(whole)) * 100).toFixed(1)}%` : null;
  return [pc ? `${/^[▲▼+−≈ ]*/.exec(String(text))[0]}${pc}` : text];
};
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
  const head = el('tr', {}, ...columns.map((c) => el('th', { class: c.num ? 'num' : null, title: c.title ?? null }, c.label)));
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
  // Without amounts, the line is read against where it started: +2.0% means two percent above the first day shown.
  const against = (v) => { const base = pts[0].value || 1, d = (v / base - 1) * 100; return `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}%`; };
  const compact = (v) => (showAmounts ? new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v) : against(v));
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
    tip.replaceChildren(el('span', { class: 'muted' }, fmtDate(p.date)), el('b', {}, showAmounts ? money(p.value) : against(p.value)));
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
    $('change').textContent = showAmounts ? `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${signed(d)}${pct} since ${fmtDate(inRange[0].date)}` : `since ${fmtDate(inRange[0].date)}`;
    // Without amounts, the headline is how far net worth has moved over the range shown.
    $('networth').textContent = showAmounts ? money(inRange.at(-1).value) : inRange[0].value ? `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${(Math.abs(d / inRange[0].value) * 100).toFixed(1)}%` : HIDDEN;
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
    if (!r.other_account) return r.category && r.account_type !== 'cash' && r.account_type !== 'credit' ? [hush(r.description), el('span', { class: 'tag' }, r.category)] : hush(r.description);
    const types = [r.account_type, r.other_type];
    const kind = types.includes('credit') ? 'Card payment' : types.includes('loan') ? 'Loan payment' : 'Transfer';
    return [hush(r.description), el('span', { class: 'tag' }, `${kind} ${r.amount < 0 ? '→' : '←'} ${r.other_account}`)];
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
  const h = overview.history, noteParts = [];
  if (h?.trimmed) noteParts.push(`The line starts on ${fmtDate(h.start)}, the first day that accounts making up at least 90% of today's total have a known value.`);
  if (h?.held) noteParts.push(`${h.held} account${h.held === 1 ? ' has' : 's have'} no past values from ${h.held === 1 ? 'its' : 'their'} institution and ${h.held === 1 ? 'is' : 'are'} drawn flat at ${h.held === 1 ? 'its' : 'their'} earliest known value.`);
  $('history-note').hidden = !noteParts.length;
  $('history-note').textContent = noteParts.join(' ');
  noDataHint = overview.demo ? 'No data yet. Press “Refresh all”.' : 'No data yet. Log in to an institution in Chrome with the coincell extension, or press “Refresh all”.';

  const count = (...types) => accounts.filter((a) => types.includes(a.type)).length;
  const plural = (n) => `${n} account${n === 1 ? '' : 's'}`;
  const b = overview.breakdown;
  const owned = b.cash + b.investments + b.retirement + b.property, owed = -(b.cards + b.loans);
  const pcOwned = (v) => (owned ? `${((Math.abs(v) / owned) * 100).toFixed(1)}%` : HIDDEN);
  const ofOwned = (v) => (showAmounts && owned ? `${pcOwned(v)} · ` : '');   // the ring beside the tiles says what the shares are of
  $('tiles').replaceChildren(...[
    ['Cash', b.cash, plural(count('cash')), 1],
    ['Investments', b.investments, plural(count('investment')), 2],
    ['Retirement', b.retirement, plural(count('retirement')), 3],
    ['Property', b.property, count('property') ? 'your own estimate' : 'none entered', 4],
    ['Owed on cards', -b.cards, plural(count('credit'))],
    ['Owed on mortgage and loans', -b.loans, plural(count('loan'))],
  ].map(([label, value, sub, colour]) => el('div', { class: 'card tile' }, el('div', { class: 'label' }, colour ? el('i', { style: `background:var(--series-${colour})` }) : null, label), el('div', { class: 'value' }, showAmounts ? money(value) : pcOwned(value)), el('div', { class: 'sub' }, ofOwned(value) + sub))));

  drawAllocation(b);

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
    { label: 'Balance', num: true, title: 'The percentage is the share of everything you own, or, for a debt, of everything you owe', get: (r) => withShare(money(r.balance), r.balance, r.balance >= 0 ? owned : owed) },
  ], grouped, 'No accounts yet.');

  const due = accounts.filter((a) => a.due_amount > 0 && a.due_date).sort((x, y) => x.due_date.localeCompare(y.due_date));
  table($('payments'), [
    { label: 'Account', get: (r) => `${r.name} ••${r.mask ?? ''}` },
    { label: 'Institution', get: (r) => r.bank_name, cls: 'muted' },
    { label: 'Due', get: (r) => { const d = daysUntil(r.due_date); return `${fmtDate(r.due_date, { month: 'short', day: 'numeric' })} (${d < 0 ? `${-d} days overdue` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`})`; } },
    { label: 'Amount to pay', num: true, title: 'The percentage is the share of your cash on hand', get: (r) => withShare(money(r.due_amount), r.due_amount, b.cash) },
    { label: 'Total owed', num: true, title: 'The percentage is the share of everything you owe', get: (r) => withShare(money(-r.balance), r.balance, owed), cls: 'muted' },
  ], due, 'Nothing due.');
  const totalDue = due.reduce((s, a) => s + a.due_amount, 0);
  $('payments-foot').textContent = due.length
    ? `${money(totalDue)} due in total. Cash on hand is ${money(b.cash)}, leaving ${money(b.cash - totalDue)} after these payments.` : '';

  const OF_INCOME = 'The percentage is the share of that month\'s income';
  table($('cashflow'), [
    { label: 'Month', get: (r) => monthName(r.month) + (r.month === networth.at(-1)?.date.slice(0, 7) ? ' (so far)' : '') },
    { label: 'Income', num: true, get: (r) => money(r.income) },
    { label: 'Spending', num: true, title: OF_INCOME, get: (r) => withShare(money(r.spending), r.spending, r.income) },
    { label: 'Left over', num: true, title: OF_INCOME, get: (r) => withShare(signed(r.income - r.spending), r.income - r.spending, r.income) },
    { label: 'Mortgage principal', num: true, title: OF_INCOME, get: (r) => withShare(money(r.loanPrincipal), r.loanPrincipal, r.income), cls: 'muted' },
    { label: 'Moved to investments', num: true, title: OF_INCOME, get: (r) => withShare(money(r.invested), r.invested, r.income), cls: 'muted' },
    { label: 'Paid to cards', num: true, title: OF_INCOME, get: (r) => withShare(money(r.cardPayments), r.cardPayments, r.income), cls: 'muted' },
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
    { label: 'Gain / loss', num: true, title: 'The percentage is the gain or loss against what it cost', get: (r) => (r.cost_basis == null ? '–' : withShare(`${r.value >= r.cost_basis ? '▲' : '▼'} ${signed(r.value - r.cost_basis)}`, r.value - r.cost_basis, r.cost_basis)) },
  ], holdings, 'No securities holdings yet.');

  const sel = $('txn-account'), keep = sel.value;
  sel.replaceChildren(el('option', { value: '' }, 'All accounts'), ...accounts.map((a) => el('option', { value: a.id }, `${a.name} (${a.bank_name})`)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';

  setRange(rangeDays);
  await loadTransactions();
  if (window.loadInsights) await window.loadInsights();
  return overview.sync;
}

// ---------- what you own, by kind ----------
// A ring with one slice per kind of asset, in the colours the tiles beside it and the by-type chart
// use. Debts are not slices (a share of a whole cannot be negative); they have their own tiles.
function drawAllocation(b) {
  const parts = [['Cash', b.cash, 1], ['Investments', b.investments, 2], ['Retirement', b.retirement, 3], ['Property', b.property, 4]].filter((p) => p[1] > 0);
  const total = parts.reduce((t, p) => t + p[1], 0), box = $('alloc');
  if (!total) return void box.replaceChildren(el('div', { class: 'muted' }, 'Nothing owned yet'));
  const share = (v) => `${((v / total) * 100).toFixed(1)}%`;
  const svg = s('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': `What you own, by kind: ${parts.map(([n, v]) => `${n} ${share(v)}`).join(', ')}` });
  const at = (r, a) => `${(100 + r * Math.cos(a)).toFixed(2)} ${(100 + r * Math.sin(a)).toFixed(2)}`;
  const R = 96, r = 60;
  let a0 = -Math.PI / 2;
  for (const [name, value, colour] of parts) {
    const a1 = a0 + Math.min(value / total, 0.9999) * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0;
    const slice = s('path', { d: `M${at(R, a0)} A${R} ${R} 0 ${big} 1 ${at(R, a1)} L${at(r, a1)} A${r} ${r} 0 ${big} 0 ${at(r, a0)} Z`,
      fill: `var(--series-${colour})`, stroke: 'var(--surface-1)', 'stroke-width': 2, 'stroke-linejoin': 'round' });
    slice.addEventListener('pointermove', (ev) => showTip(ev, name, [{ color: `var(--series-${colour})`, name: share(value), value: money(value) }]));
    slice.addEventListener('pointerleave', hideTip);
    svg.append(slice);
    a0 = a1;
  }
  const text = (y, size, weight, fill, str) => { const t = s('text', { x: 100, y, 'text-anchor': 'middle', 'font-size': size, 'font-weight': weight, fill }); t.textContent = str; return t; };
  svg.append(text(92, 11, 400, 'var(--text-muted)', showAmounts ? 'You own' : 'What you own'),
    text(114, 19, 620, 'var(--text-primary)', showAmounts ? new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 2 }).format(total) : 'by kind'));
  box.replaceChildren(svg);
}

// ---------- refreshing ----------
// Each institution is read the way it can be: through the browser extension in your own Chrome,
// or directly by coincell. This shows where each one stands and lets you ask for a refresh.
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' }, body: JSON.stringify(body) });
const READ_BY = { extension: 'Your Chrome, via the extension', browser: 'A browser coincell opens', file: 'A file on this computer' };
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
let lastSeenImport = null;   // null until the first look, so the first look does not count as a change

function standing(i) {   // one phrase for where an institution stands, with a mark that is not colour alone
  const p = i.progress;
  if (p?.state === 'queued' || p?.state === 'working') return [el('span', { class: 'mark' }, '… '), p.message || 'Working'];
  if (p?.state === 'needs-code') return [el('span', { class: 'mark' }, '→ '), 'Needs a code: enter it under Settings'];
  if (p?.state === 'needs-approval') return [el('span', { class: 'mark' }, '→ '), p.message];
  if (p?.state === 'needs-login') return [el('span', { class: 'mark' }, '→ '), 'Needs a login in Chrome'];
  if (p?.state === 'failed') return [el('span', { class: 'mark bad' }, '✕ '), p.message];
  if (!i.last) return [el('span', { class: 'muted' }, 'Never read')];
  const warnings = i.last.warnings ?? [];
  return [el('span', { class: `mark ${i.last.ok && !warnings.length ? 'ok' : 'bad'}` }, i.last.ok ? (warnings.length ? '⚠ ' : '✓ ') : '✕ '), `${i.last.message} · ${ago(i.last.at)}`,
    ...warnings.map((w) => el('div', { class: 'muted' }, w))];
}

function showStanding(st) {
  if (document.activeElement?.classList.contains('code-input')) return;   // you are typing a code: leave the table alone
  $('ext-note').textContent = st.institutions.some((i) => i.readBy === 'extension') ? (st.extension ? `Browser extension ${st.extensionVersion ?? ''} connected.` : 'Browser extension not connected: open Chrome with the coincell extension loaded.') : '';
  table($('institutions'), [
    { label: 'Institution', get: (r) => r.name },
    { label: 'Read through', get: (r) => READ_BY[r.readBy], cls: 'muted' },
    { label: 'Data as of', get: (r) => (r.asOf ? fmtDate(r.asOf, { month: 'short', day: 'numeric' }) : '–'), cls: 'muted' },
    { label: 'Last refresh', get: standing, cls: 'wrap' },
    { label: '', num: true, get: (r) => { const b = el('button', { class: 'small', 'data-bank': r.id }, 'Refresh'); b.disabled = ['queued', 'working'].includes(r.progress?.state); return b; } },
  ], st.institutions, 'No institutions yet.');
  latest = st;
  // Settings: one row per institution the extension can sign in to.
  table($('logins'), [
    // Two columns, so it fits a phone: the name with its details underneath, and the button.
    { label: 'Institution', get: (r) => [r.name, el('div', { class: 'muted' }, r.isDefault ? st.codesInbox || 'First Gmail in Chrome'
      : [r.loginSavedAt ? `Login saved ${ago(r.loginSavedAt)}` : 'No login', r.makesCodes && 'authenticator', r.inbox && `codes to ${r.inbox}`].filter(Boolean).join(' · ')),
      // A site waiting for a sign-in code asks for it here, where its login lives.
      r.progress?.state === 'needs-code' ? el('form', { class: 'code-form', 'data-code': r.id }, el('input', { class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'code', 'aria-label': `Sign-in code for ${r.name}`, title: r.progress.message, maxlength: 10 }), el('button', { class: 'small' }, 'Enter')) : null] },
    { label: '', num: true, get: (r) => el('button', { class: 'small', 'data-login': r.id }, r.isDefault || r.loginSavedAt ? 'Change' : 'Save a login…') },
  ], st.institutions.some((i) => i.canSignIn) ? [{ id: DEFAULT, name: 'Default inbox', isDefault: true }, ...st.institutions.filter((i) => i.canSignIn)] : [], st.extension ? 'The extension cannot sign in to any of your institutions yet.' : 'Open Chrome with the coincell extension loaded to set this up.');
  const busy = st.institutions.filter((i) => ['queued', 'working'].includes(i.progress?.state)).length;
  const login = st.institutions.filter((i) => i.progress?.state === 'needs-login').map((i) => i.name);
  const code = st.institutions.filter((i) => i.progress?.state === 'needs-code').map((i) => i.name);
  const stale = st.institutions.map((i) => i.last?.at).filter(Boolean).sort()[0];
  $('refresh').disabled = st.active;
  const approve = st.institutions.filter((i) => i.progress?.state === 'needs-approval').map((i) => i.name);
  $('status').textContent = approve.length ? `Approve the ${approve.join(', ')} sign-in on your phone` : code.length ? `${code.join(', ')} needs a code: enter it under Settings` : busy ? `Refreshing ${busy} of ${st.institutions.length}…` : login.length ? `Log in to ${login.join(', ')} in Chrome` : stale ? `Oldest refresh ${ago(stale)}` : '';
}

async function watch() {   // follow a refresh to its end, then show the new numbers
  const st = await api('/api/status');
  showStanding(st);
  const newest = st.institutions.map((i) => i.last?.at ?? '').sort().at(-1);
  if (newest !== lastSeenImport) { const first = lastSeenImport === null; lastSeenImport = newest; if (!first) await load(); }
  setTimeout(watch, st.active ? 1500 : 15_000);   // idle: still look now and then, for syncs that start when you log in
}
async function refresh(bank) {
  $('refresh').disabled = true;
  try { await post('/api/refresh', { bank }); showStanding(await api('/api/status')); } catch (e) { $('status').textContent = e.message; $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', () => refresh('all'));
// The switch between percentages and amounts.
const paintFigures = () => { for (const b of $('figures').children) b.setAttribute('aria-pressed', String((b.dataset.figures === 'amounts') === showAmounts)); };
paintFigures();
$('figures').addEventListener('click', (e) => {
  const want = e.target.closest('[data-figures]')?.dataset.figures;
  if (!want) return;
  showAmounts = want === 'amounts'; localStorage.setItem('figures', want); paintFigures(); load();
});
$('institutions').addEventListener('click', (e) => { if (e.target.dataset.bank) refresh(e.target.dataset.bank); });
$('logins').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('[data-code]'), input = form.querySelector('input');
  try { await post('/api/code', { site: form.dataset.code, code: input.value.trim() }); input.blur(); form.replaceChildren('Code sent to the site…'); } catch (err) { input.setCustomValidity(err.message); input.reportValidity(); input.setCustomValidity(''); }
});
$('logins').addEventListener('click', (e) => { if (e.target.dataset.login) askLogin(e.target.dataset.login); });

// ---------- saved logins ----------
// A login typed here goes to coincell on this computer and from there only to the extension, to be
// filled in on that institution's own sign-in page. It is never shown again, here or anywhere.
let latest = null, loginFor = null;
const DEFAULT = '_default';   // the row for the default inbox, which has no login of its own
function askLogin(id) {
  loginFor = id;
  $('login-fields').hidden = id === DEFAULT;
  $('login-error').hidden = true;
  if (id === DEFAULT) {
    $('login-title').textContent = 'Default inbox for sign-in codes';
    $('login-note').textContent = 'Used for every institution that does not name its own. Leave it empty to use the first Gmail account that Chrome is signed in to.';
    $('login-inbox-label').textContent = 'Gmail inbox';
    $('login-inbox').value = latest.codesInbox; $('login-inbox').placeholder = 'the first Gmail signed in to';
    $('login-remove').hidden = true;
    return $('login-dialog').showModal();
  }
  $('login-inbox-label').textContent = 'Gmail inbox its codes arrive in (optional)';
  const inst = latest.institutions.find((i) => i.id === id);
  $('login-title').textContent = `Login for ${inst.name}`;
  $('login-note').textContent = `Kept in ${latest.loginStore}${inst.loginSavedAt ? `. One was saved ${ago(inst.loginSavedAt)}; saving replaces it.` : '.'}`;
  $('login-user').value = ''; $('login-pass').value = ''; $('login-totp').value = ''; $('login-totp').placeholder = inst.makesCodes ? 'unchanged' : ''; $('login-inbox').value = inst.inbox ?? ''; $('login-error').hidden = true;
  $('login-inbox').placeholder = latest.codesInbox || 'the default inbox';
  for (const id of ['login-user', 'login-pass']) $(id).placeholder = inst.loginSavedAt ? 'unchanged' : '';
  $('login-remove').hidden = !inst.loginSavedAt;
  $('login-dialog').showModal();
}
async function sendLogin(body) {
  try { if (loginFor === DEFAULT) await post('/api/settings', { codesInbox: body.inbox }); else await post('/api/logins', { site: loginFor, ...body }); $('login-pass').value = ''; $('login-totp').value = ''; $('login-dialog').close(); showStanding(await api('/api/status')); }
  catch (e) { $('login-error').textContent = e.message; $('login-error').hidden = false; }
}
$('login-form').addEventListener('submit', (e) => { e.preventDefault(); sendLogin({ username: $('login-user').value.trim(), password: $('login-pass').value, totp: $('login-totp').value.trim() || undefined, inbox: $('login-inbox').value.trim() }); });
$('login-remove').addEventListener('click', () => sendLogin({ remove: true }));
$('login-cancel').addEventListener('click', () => { $('login-pass').value = ''; $('login-totp').value = ''; $('login-dialog').close(); });
$('range').addEventListener('click', (e) => { if (e.target.dataset.days != null) setRange(Number(e.target.dataset.days)); });
$('txn-account').addEventListener('change', loadTransactions);
const setMode = (mode) => { nwMode = mode; localStorage.setItem('nwMode', mode); for (const b of $('nw-mode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); drawChart(); };
$('nw-mode').addEventListener('click', (e) => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
for (const b of $('nw-mode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === nwMode));
new ResizeObserver(() => drawChart()).observe($('chart'));

load().then(watch).catch((e) => { $('status').textContent = e.message; });
