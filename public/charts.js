'use strict';
// Charts for the Insights tab and the by-type net worth view. Uses helpers from app.js
// ($, el, s, niceTicks, money, signed, fmtDate, parseDate). Colours come from CSS
// variables, so light and dark mode each get their own validated steps.
const C = (n) => `var(--series-${n})`;
const compactMoney = (v) => new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
const nice = (str) => str.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// One shared tooltip. Rows are { color?, line?, name, value }.
const viztip = document.body.appendChild(el('div', { class: 'viztip' }));
function showTip(ev, head, rows = []) {
  viztip.replaceChildren(el('div', { class: 'head' }, head), ...rows.map((r) => el('div', { class: 'row' },
    r.color ? el('i', { class: 'key line', style: `background:${r.color}` }) : null, el('span', {}, r.name), el('b', {}, r.value))));
  viztip.style.display = 'block';
  const w = viztip.offsetWidth, h = viztip.offsetHeight;
  viztip.style.left = `${ev.clientX + 14 + w > innerWidth ? ev.clientX - 14 - w : ev.clientX + 14}px`;
  viztip.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, ev.clientY - h - 10))}px`;
}
const hideTip = () => { viztip.style.display = 'none'; };
const legend = (box, items) => box.replaceChildren(...items.map((i) => el('span', {}, el('i', { class: `key${i.line ? ' line' : ''}`, style: `background:${i.color}` }), i.name)));

/** Start a chart: clears the box and returns an svg plus its size, or null while the tab is hidden. */
function begin(box, height) {
  box.querySelector('svg')?.remove();
  box.querySelector('.empty')?.remove();
  const W = box.clientWidth;
  if (!W) return null;
  const svg = el('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'img' });
  box.append(svg);
  return { svg, W, H: height };
}
const empty = (box, text) => { box.querySelector('svg')?.remove(); box.querySelector('.empty')?.remove(); box.append(el('div', { class: 'empty' }, text)); };

function yAxis(svg, ticks, y, x0, x1, fmt = compactMoney) {
  for (const t of ticks) {
    svg.append(s('line', { x1: x0, x2: x1, y1: y(t), y2: y(t), stroke: t === 0 && ticks[0] < 0 ? 'var(--text-muted)' : 'var(--grid)', 'stroke-width': 1 }),
      s('text', { x: x0 - 8, y: y(t) + 4, 'text-anchor': 'end' }, fmt(t)));
  }
}
const leftMargin = (ticks, fmt = compactMoney) => 16 + Math.max(...ticks.map((t) => fmt(t).length)) * 6.4;
const linePath = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/** Vertical crosshair that snaps to the nearest x position and reports its index. */
function crosshair(svg, xs, top, bottom, onMove) {
  const line = s('line', { y1: top, y2: bottom, stroke: 'var(--text-muted)', 'stroke-width': 1, visibility: 'hidden' });
  svg.append(line);
  const move = (ev) => {
    const px = ev.clientX - svg.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    line.setAttribute('x1', xs[best]); line.setAttribute('x2', xs[best]); line.setAttribute('visibility', 'visible');
    onMove(ev, best);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { line.setAttribute('visibility', 'hidden'); hideTip(); });
}

// ---------- 1. net worth by type (Overview) ----------
const NW_PARTS = [['cash', 'Cash', 1], ['investments', 'Investments', 2], ['retirement', 'Retirement', 3], ['property', 'Property', 4], ['debt', 'Debt', 5]];
window.drawNetWorthByType = function drawNetWorthByType(box, rows, legendBox) {
  const c = begin(box, box.clientHeight || 260);
  if (!c || !rows.length) return;
  const { svg, W, H } = c;
  const used = NW_PARTS.filter(([k]) => rows.some((r) => r[k]));
  legend(legendBox, [...used.map(([, name, n]) => ({ name, color: C(n) })), { name: 'Net worth', color: 'var(--text-primary)', line: true }]);
  const up = used.filter(([k]) => k !== 'debt');
  const tops = rows.map((r) => up.reduce((sum, [k]) => sum + Math.max(0, r[k]), 0));
  const ticks = niceTicks(Math.min(0, ...rows.map((r) => r.debt)), Math.max(...tops), 5);
  const m = { t: 10, r: 14, b: 24, l: leftMargin(ticks) };
  const t0 = parseDate(rows[0].date).getTime(), t1 = parseDate(rows.at(-1).date).getTime();
  const xs = rows.map((r) => (t1 === t0 ? (m.l + W - m.r) / 2 : m.l + ((parseDate(r.date).getTime() - t0) / (t1 - t0)) * (W - m.l - m.r)));
  const y = (v) => m.t + (1 - (v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (H - m.t - m.b);
  yAxis(svg, ticks, y, m.l, W - m.r);
  const band = (lo, hi, n) => {
    svg.append(s('path', { d: `${linePath(xs.map((x, i) => [x, y(hi[i])]))}L${xs.map((x, i) => `${x.toFixed(1)},${y(lo[i]).toFixed(1)}`).reverse().join('L')}Z`, fill: C(n), 'fill-opacity': 0.16 }),
      s('path', { d: linePath(xs.map((x, i) => [x, y(hi[i])])), fill: 'none', stroke: C(n), 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  };
  let base = rows.map(() => 0);
  for (const [k, , n] of up) { const top = rows.map((r, i) => base[i] + Math.max(0, r[k])); band(base, top, n); base = top; }
  if (used.some(([k]) => k === 'debt')) band(rows.map(() => 0), rows.map((r) => r.debt), 5);
  const net = rows.map((r) => NW_PARTS.reduce((sum, [k]) => sum + r[k], 0));
  svg.append(s('path', { d: linePath(xs.map((x, i) => [x, y(net[i])])), fill: 'none', stroke: 'var(--text-primary)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  for (const i of [0, Math.floor(rows.length / 2), rows.length - 1].filter((v, j, a) => a.indexOf(v) === j)) {
    svg.append(s('text', { x: xs[i], y: H - 6, 'text-anchor': i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle' }, fmtDate(rows[i].date, { month: 'short', day: 'numeric' })));
  }
  crosshair(svg, xs, m.t, H - m.b, (ev, i) => showTip(ev, fmtDate(rows[i].date), [
    ...[...used].reverse().map(([k, name, n]) => ({ color: C(n), name, value: money(rows[i][k]) })), { color: 'var(--text-primary)', name: 'Net worth', value: money(net[i]) }]));
};

// ---------- 2. saved vs market, per month ----------
function drawSavedMarket(d) {
  const box = $('c-savedmarket');
  const rows = d.months.filter((m) => m.market != null).slice().reverse();
  if (!rows.length) return empty(box, 'Needs at least one month of history.');
  const c = begin(box, 220);
  if (!c) return;
  const { svg, W, H } = c;
  legend($('c-savedmarket-legend'), [{ name: 'You saved', color: C(1) }, { name: 'Market movement', color: C(2) }]);
  const vals = rows.flatMap((r) => [r.saved, r.market]);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const m = { t: 10, r: 10, b: 24, l: leftMargin(ticks) };
  const y = (v) => m.t + (1 - (v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (H - m.t - m.b);
  yAxis(svg, ticks, y, m.l, W - m.r);
  const slot = (W - m.l - m.r) / rows.length, bw = Math.min(24, (slot - 14) / 2);
  const column = (x, v, color) => { // rounded at the data end, square at the zero line
    const y0 = y(0), y1 = y(v), r = Math.min(4, Math.abs(y1 - y0)), dir = v >= 0 ? 1 : -1;
    return s('path', { d: `M${x},${y0}V${y1 + dir * r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + dir * r}V${y0}Z`, fill: color });
  };
  rows.forEach((r, i) => {
    const cx = m.l + slot * (i + 0.5), thisMonth = r.month === (d.asOf ?? '').slice(0, 7);
    const group = s('g', { tabindex: 0 }, column(cx - bw - 1, r.saved, C(1)), column(cx + 1, r.market, C(2)),
      s('rect', { x: cx - slot / 2, y: m.t, width: slot, height: H - m.t - m.b, fill: 'transparent' }));
    const tip = (ev) => showTip(ev, monthName(r.month) + (thisMonth ? ' (so far)' : ''), [{ color: C(1), name: 'You saved', value: signed(r.saved) }, { color: C(2), name: 'Market movement', value: signed(r.market) }, { name: 'Net worth change', value: signed(r.change) }]);
    group.addEventListener('pointermove', tip); group.addEventListener('pointerleave', hideTip);
    svg.append(group, s('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, new Date(Number(r.month.slice(0, 4)), Number(r.month.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'short' }) + (thisMonth ? '*' : '')));
  });
}

// ---------- 3. where a month's money went (flow diagram) ----------
function drawFlow(d) {
  const box = $('c-flow'), f = d.flow;
  if (!f || !f.sources.length) return empty(box, 'Needs one full month of history.');
  $('c-flow-head').textContent = `${monthName(f.month)}, the last full month. Band width is the amount.`;
  legend($('c-flow-legend'), [{ name: 'Money in', color: C(1) }, { name: 'Spent', color: C(2) }, { name: 'Saved and invested', color: C(3) }]);
  const right = [...f.spending.map((x) => ({ ...x, color: C(2) })), ...f.saving.map((x) => ({ ...x, color: C(3), saving: true }))];
  const left = f.sources.map((x) => ({ ...x, color: C(1) }));
  const total = left.reduce((a, x) => a + x.value, 0), gap = 16, groupGap = 14;
  const height = Math.max(340, right.length * 30 + 40);
  const c = begin(box, height);
  if (!c) return;
  const { svg, W, H } = c;
  const narrow = W < 620, labelL = narrow ? 110 : 190, labelR = narrow ? 120 : 200, node = 8, pad = 10;
  const scale = (H - 2 * pad - gap * (right.length - 1) - groupGap) / total;
  const place = (items, extraAt) => {
    const used = items.reduce((a, x) => a + Math.max(2, x.value * scale), 0) + gap * (items.length - 1) + (extraAt ? groupGap : 0);
    let yy = (H - used) / 2;
    items.forEach((it, i) => { if (extraAt && i === extraAt) yy += groupGap; it.y = yy; it.h = Math.max(2, it.value * scale); yy += it.h + gap; });
  };
  place(left); place(right, f.spending.length);
  const mid = { x: W / 2 - node / 2, h: total * scale }; mid.y = (H - mid.h) / 2;
  const xl = labelL, xr = W - labelR - node;
  const ribbon = (x0, y0, h0, x1, y1, h1, color, name, value) => {
    const xm = (x0 + x1) / 2;
    const p = s('path', { d: `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}V${y1 + h1}C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0}Z`, fill: color, 'fill-opacity': 0.28, tabindex: 0 });
    p.addEventListener('pointermove', (ev) => { p.setAttribute('fill-opacity', 0.5); showTip(ev, name, [{ color, name: `${((value / total) * 100).toFixed(1)}% of money in`, value: money(value) }]); });
    p.addEventListener('pointerleave', () => { p.setAttribute('fill-opacity', 0.28); hideTip(); });
    svg.append(p);
  };
  let off = mid.y;
  for (const it of left) { const h = it.value * scale; ribbon(xl + node, it.y, it.h, mid.x, off, h, it.color, nice(it.name), it.value); off += h; }
  off = mid.y;
  for (const it of right) { const h = it.value * scale; ribbon(mid.x + node, off, h, xr, it.y, it.h, it.color, it.name, it.value); off += h; }
  svg.append(s('rect', { x: mid.x, y: mid.y, width: node, height: mid.h, rx: 2, fill: 'var(--text-secondary)' }));
  const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  for (const it of left) {
    svg.append(s('rect', { x: xl, y: it.y, width: node, height: it.h, rx: 2, fill: it.color }),
      s('text', { x: xl - 8, y: it.y + it.h / 2 - 2, 'text-anchor': 'end', class: 'ink' }, clip(nice(it.name), narrow ? 16 : 30)),
      s('text', { x: xl - 8, y: it.y + it.h / 2 + 11, 'text-anchor': 'end' }, money(it.value)));
  }
  for (const it of right) {
    svg.append(s('rect', { x: xr, y: it.y, width: node, height: it.h, rx: 2, fill: it.color }),
      s('text', { x: xr + node + 8, y: it.y + it.h / 2 + 4, class: 'ink' }, clip(it.name, narrow ? 12 : 24)),
      s('text', { x: W - 2, y: it.y + it.h / 2 + 4, 'text-anchor': 'end' }, money(it.value)));
  }
  svg.append(s('text', { x: W / 2, y: mid.y - 6 < 12 ? 12 : mid.y - 6, 'text-anchor': 'middle', class: 'strong' }, money(total)));
}

// ---------- 4. cash runway ----------
function drawRunway(d) {
  const box = $('c-runway'), rw = d.runway;
  if (!rw) return empty(box, 'No cash account yet.');
  const c = begin(box, 200);
  if (!c) return;
  const { svg, W, H } = c;
  const start = d.asOf, dayMs = 86_400_000, t0 = parseDate(start).getTime();
  const days = []; // one balance per day, stepping when something is expected
  let bal = rw.balance;
  for (let i = 0; i <= rw.days; i++) {
    const date = new Date(t0 + i * dayMs), iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const events = rw.events.filter((e) => e.date === iso);
    for (const e of events) bal = e.balance;
    days.push({ iso, balance: bal, events });
  }
  const ticks = niceTicks(Math.min(rw.threshold, ...days.map((x) => x.balance)), Math.max(...days.map((x) => x.balance)), 4);
  const m = { t: 10, r: 14, b: 24, l: leftMargin(ticks) };
  const xs = days.map((_, i) => m.l + (i / rw.days) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (H - m.t - m.b);
  yAxis(svg, ticks, y, m.l, W - m.r);
  svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(rw.threshold), y2: y(rw.threshold), stroke: 'var(--text-secondary)', 'stroke-width': 1 }),
    s('text', { x: W - m.r, y: y(rw.threshold) - 5, 'text-anchor': 'end', class: 'ink' }, `Warning level ${money(rw.threshold, { maximumFractionDigits: 0 })}`));
  let path = `M${xs[0]},${y(days[0].balance)}`;
  for (let i = 1; i < days.length; i++) path += `H${xs[i].toFixed(1)}V${y(days[i].balance).toFixed(1)}`;
  svg.append(s('path', { d: path, fill: 'none', stroke: C(1), 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  const lowIdx = days.findIndex((x) => x.iso === rw.low.date);
  if (lowIdx > 0) svg.append(s('circle', { cx: xs[lowIdx], cy: y(rw.low.balance), r: 4.5, fill: C(1), stroke: 'var(--surface-1)', 'stroke-width': 2 }),
    s('text', { x: xs[lowIdx], y: y(rw.low.balance) + 16, 'text-anchor': lowIdx > rw.days * 0.85 ? 'end' : 'middle', class: 'ink' }, `Low ${money(rw.low.balance, { maximumFractionDigits: 0 })}`));
  for (const i of [0, 15, 30, 45].filter((v) => v <= rw.days)) svg.append(s('text', { x: xs[i], y: H - 6, 'text-anchor': i === 0 ? 'start' : i === rw.days ? 'end' : 'middle' }, fmtDate(days[i].iso, { month: 'short', day: 'numeric' })));
  crosshair(svg, xs, m.t, H - m.b, (ev, i) => showTip(ev, fmtDate(days[i].iso), [
    ...days[i].events.map((e) => ({ name: nice(e.label), value: signed(e.amount) })), { color: C(1), name: 'Balance', value: money(days[i].balance) }]));
}

// ---------- 5. spending calendar ----------
function drawCalendar(d) {
  const box = $('c-calendar'), days = d.daily;
  if (!days?.length) return empty(box, 'No spending yet.');
  const nonzero = days.map((x) => x.total).filter((v) => v > 0).sort((a, b) => a - b);
  const cap = nonzero[Math.floor(nonzero.length * 0.9)] ?? 1; // a rent day should not wash out every other day
  const first = parseDate(days[0].date), lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const weeks = Math.ceil((days.length + lead) / 7);
  const probe = box.clientWidth;
  if (!probe) return;
  const size = Math.max(10, Math.min(22, Math.floor((probe - 40) / weeks) - 2)), step = size + 2;
  const c = begin(box, 22 + 7 * step);
  const { svg } = c;
  ['Mon', 'Wed', 'Fri', 'Sun'].forEach((name, i) => svg.append(s('text', { x: 0, y: 22 + (i * 2) * step + size - 3 }, name)));
  let lastMonth = -1;
  days.forEach((day, i) => {
    const col = Math.floor((i + lead) / 7), row = (i + lead) % 7, date = parseDate(day.date);
    if (date.getMonth() !== lastMonth && (row === 0 || i === 0)) { lastMonth = date.getMonth(); svg.append(s('text', { x: 34 + col * step, y: 12 }, date.toLocaleDateString(undefined, { month: 'short' }))); }
    const level = day.total <= 0 ? 0 : Math.min(5, 1 + Math.floor((day.total / cap) * 4));
    const cell = s('rect', { x: 34 + col * step, y: 22 + row * step, width: size, height: size, rx: 3, fill: level ? `var(--seq-${level})` : 'var(--grid)', tabindex: 0 });
    cell.addEventListener('pointermove', (ev) => { cell.setAttribute('stroke', 'var(--text-primary)'); cell.setAttribute('stroke-width', 1.5);
      showTip(ev, date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), day.total ? [{ name: `${day.count} payment${day.count === 1 ? '' : 's'}`, value: money(day.total) }, { name: `Largest: ${nice(day.top.merchant)}`, value: money(day.top.amount) }] : [{ name: 'Nothing spent', value: '' }]); });
    cell.addEventListener('pointerleave', () => { cell.removeAttribute('stroke'); hideTip(); });
    svg.append(cell);
  });
  $('c-calendar-head').textContent = `${days.length} days. Stronger colour means more spent; the scale tops out at ${money(cap, { maximumFractionDigits: 0 })} a day.`;
  $('c-calendar-legend').replaceChildren(el('span', {}, 'Less'), ...[0, 1, 2, 3, 4, 5].map((l) => el('i', { class: 'key', style: `background:${l ? `var(--seq-${l})` : 'var(--grid)'};margin:0 -6px 0 0` })), el('span', { style: 'margin-left:6px' }, 'More'));
}

// ---------- 6. mortgage payoff curves ----------
function drawPayoff(d) {
  const box = $('c-payoff'), loan = d.debt.loans.find((l) => l.points);
  if (!loan) { $('c-payoff-legend').replaceChildren(); return box.replaceChildren(); }
  const c = begin(box, 240);
  if (!c) return;
  const { svg, W, H } = c;
  const year0 = parseDate(loan.start).getFullYear() + parseDate(loan.start).getMonth() / 12;
  const lines = [{ name: 'Current payment', points: loan.points, payoff: loan.payoff }, ...loan.scenarios.map((sc) => ({ name: `${money(sc.extra, { maximumFractionDigits: 0 })} more a month`, points: sc.points, payoff: sc.payoff }))].slice(0, 4);
  legend($('c-payoff-legend'), lines.map((l, i) => ({ name: `${l.name}: paid off ${fmtDate(l.payoff, { month: 'short', year: 'numeric' })}`, color: C(i + 1), line: true })));
  const maxMonths = loan.points.at(-1).months, ticks = niceTicks(0, loan.balance, 4);
  const m = { t: 10, r: 14, b: 24, l: leftMargin(ticks) };
  const x = (months) => m.l + (months / maxMonths) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v / ticks.at(-1)) * (H - m.t - m.b);
  yAxis(svg, ticks, y, m.l, W - m.r);
  lines.forEach((l, i) => svg.append(s('path', { d: linePath(l.points.map((p) => [x(p.months), y(p.balance)])), fill: 'none', stroke: C(i + 1), 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    s('circle', { cx: x(l.points.at(-1).months), cy: y(0), r: 4.5, fill: C(i + 1), stroke: 'var(--surface-1)', 'stroke-width': 2 })));
  const every = maxMonths > 240 ? 60 : 48;
  for (let mo = 0; mo <= maxMonths; mo += every) svg.append(s('text', { x: x(mo), y: H - 6, 'text-anchor': mo === 0 ? 'start' : 'middle' }, String(Math.floor(year0 + mo / 12))));
  const grid = loan.points.map((p) => p.months), at = (l, months) => l.points.find((p) => p.months >= months)?.balance ?? 0;
  crosshair(svg, grid.map(x), m.t, H - m.b, (ev, i) => showTip(ev, String(Math.floor(year0 + grid[i] / 12)) + (grid[i] % 12 ? ' (mid-year)' : ''), lines.map((l, j) => ({ color: C(j + 1), name: l.name, value: money(at(l, grid[i]), { maximumFractionDigits: 0 }) }))));
}

// ---------- 7. when investments could cover spending ----------
function drawProjection(d) {
  const box = $('c-fi'), p = d.projection;
  if (!p) return empty(box, 'Needs one full month of history.');
  const pc = (r) => `${(r * 100).toFixed(0)}%`;
  $('c-fi-head').textContent = `Starting from ${money(p.start, { maximumFractionDigits: 0 })} and adding ${money(p.monthly, { maximumFractionDigits: 0 })} a month, in today's dollars.`;
  legend($('c-fi-legend'), [{ name: `${pc(p.returns.mid)} return after inflation`, color: C(1), line: true }, { name: `Range from ${pc(p.returns.low)} to ${pc(p.returns.high)}`, color: 'color-mix(in srgb, var(--series-1) 22%, transparent)' }]);
  const last = Math.min(p.years.length - 1, (p.reach.low ?? p.reach.mid ?? p.years.at(-1).year) - p.years[0].year + 3);
  const rows = p.years.slice(0, last + 1);
  const c = begin(box, 260);
  if (!c) return;
  const { svg, W, H } = c;
  const ticks = niceTicks(0, Math.max(p.target * 1.1, rows.at(-1).high), 5);
  const m = { t: 14, r: 14, b: 24, l: leftMargin(ticks) };
  const xs = rows.map((_, i) => m.l + (i / (rows.length - 1)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - Math.min(v, ticks.at(-1)) / ticks.at(-1)) * (H - m.t - m.b);
  yAxis(svg, ticks, y, m.l, W - m.r);
  svg.append(s('path', { d: `${linePath(rows.map((r, i) => [xs[i], y(r.high)]))}L${rows.map((r, i) => `${xs[i].toFixed(1)},${y(r.low).toFixed(1)}`).reverse().join('L')}Z`, fill: C(1), 'fill-opacity': 0.12 }),
    s('line', { x1: m.l, x2: W - m.r, y1: y(p.target), y2: y(p.target), stroke: 'var(--text-secondary)', 'stroke-width': 1 }),
    s('text', { x: m.l + 6, y: y(p.target) - 6, class: 'ink' }, `Enough to cover ${money(p.annualSpending, { maximumFractionDigits: 0 })} a year: ${compactMoney(p.target)}`),
    s('path', { d: linePath(rows.map((r, i) => [xs[i], y(r.mid)])), fill: 'none', stroke: C(1), 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  if (p.reach.mid) {
    const i = p.reach.mid - rows[0].year;
    if (i < rows.length) svg.append(s('circle', { cx: xs[i], cy: y(rows[i].mid), r: 4.5, fill: C(1), stroke: 'var(--surface-1)', 'stroke-width': 2 }), s('text', { x: xs[i] + 8, y: y(rows[i].mid) + 16, class: 'strong' }, String(p.reach.mid)));
  }
  const stepYears = rows.length > 24 ? 5 : rows.length > 12 ? 4 : 2;
  rows.forEach((r, i) => { if (i % stepYears === 0) svg.append(s('text', { x: xs[i], y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle' }, String(r.year))); });
  crosshair(svg, xs, m.t, H - m.b, (ev, i) => showTip(ev, String(rows[i].year), [
    { name: `At ${pc(p.returns.high)}`, value: compactMoney(rows[i].high) }, { color: C(1), name: `At ${pc(p.returns.mid)}`, value: compactMoney(rows[i].mid) }, { name: `At ${pc(p.returns.low)}`, value: compactMoney(rows[i].low) }]));
  const when = (k) => p.reach[k] ?? 'beyond 50 years';
  $('c-fi-foot').textContent = `Reached around ${when('mid')} at ${pc(p.returns.mid)}, between ${when('high')} and ${when('low')} across the range. The target is 25 times your current yearly spending (the "4% rule"). `
    + 'It assumes your saving and spending stay as they are now, ignores taxes on withdrawals, and counts cash, investment and retirement accounts but not your home.';
}

let chartData = null;
window.redrawCharts = () => { if (!chartData) return; for (const draw of [drawSavedMarket, drawFlow, drawCalendar, drawRunway, drawPayoff, drawProjection]) draw(chartData); };
window.setChartData = (d) => { chartData = d; window.redrawCharts(); };
let resizeTimer;
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(window.redrawCharts, 80); }).observe($('tab-insights'));
