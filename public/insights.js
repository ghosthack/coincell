'use strict';
// The Insights tab. Uses the helpers from app.js ($, el, table, money, signed, fmtDate, api).
const pct = (n, digits = 1) => (n == null ? '–' : `${(n * 100).toFixed(digits)}%`);
const shortDate = (iso) => fmtDate(iso, { month: 'short', day: 'numeric' });
const monthYear = (iso) => fmtDate(iso, { month: 'short', year: 'numeric' });
const tag = (text) => el('span', { class: 'tag' }, text);
const bar = (share, target) => el('div', { class: 'bar' },
  el('i', { style: `width:${Math.max(0, Math.min(1, share)) * 100}%` }),
  target == null ? null : el('b', { style: `left:calc(${Math.min(1, target) * 100}% - 1px)`, title: `Target ${pct(target, 0)}` }));
const title = (s) => s.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

window.loadInsights = async function loadInsights() {
  const d = await api('/api/insights');
  const tile = (label, value, sub) => el('div', { class: 'card tile' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), el('div', { class: 'sub' }, sub));
  const loan = d.debt.loans.find((l) => l.payoff);
  const active = d.recurring.filter((r) => r.status !== 'stopped');
  const changed = d.recurring.filter((r) => r.status !== 'active').length;
  $('ins-tiles').replaceChildren(
    tile('Savings rate', d.trailing ? pct(d.trailing.rate, 0) : '–', d.trailing ? `${money(d.trailing.saved)} a month, last ${d.trailing.months} full months` : 'needs one full month'),
    tile('Lowest balance ahead', d.runway ? money(d.runway.low.balance) : '–', d.runway ? `${d.runway.warn ? '⚠ below your ' + money(d.runway.threshold, { maximumFractionDigits: 0 }) + ' line, ' : ''}${d.runway.account}, ${shortDate(d.runway.low.date)}` : ''),
    tile('Recurring bills', `${money(d.recurringAnnual, { maximumFractionDigits: 0 })} a year`, `${active.length} active${changed ? `, ${changed} changed recently` : ''}`),
    tile('Card utilisation', pct(d.debt.utilization, 0), d.debt.cards.length ? `of ${money(d.debt.cards.reduce((s, c) => s + (c.limit ?? 0), 0), { maximumFractionDigits: 0 })} in limits` : 'no cards'),
    tile('Mortgage paid off', loan ? monthYear(loan.payoff) : '–', loan ? `${money(loan.interestRemaining, { maximumFractionDigits: 0 })} interest still to pay` : 'no loan with a known rate'),
    tile('Worth a second look', String(d.anomalies.length), d.anomalies.length ? [...new Set(d.anomalies.map((a) => a.kind.toLowerCase()))].join(', ') : 'nothing flagged'),
  );

  const marks = { action: '!', idea: '→', good: '✓' };
  $('ins-advice').replaceChildren(...(d.advice.length ? d.advice.map((a) => el('div', { class: 'item' }, el('span', { class: 'mark', title: a.tone }, marks[a.tone]), el('span', { class: 'title' }, a.title), el('span', { class: 'text' }, a.text)))
    : [el('div', { class: 'empty' }, 'Nothing to suggest yet.')]));
  window.setChartData(d);

  const thisMonth = (d.asOf ?? '').slice(0, 7);
  table($('ins-months'), [
    { label: 'Month', get: (r) => monthName(r.month) + (r.month === thisMonth ? ' (so far)' : '') },
    { label: 'Income', num: true, get: (r) => money(r.income + r.contributions) },
    { label: 'Spending', num: true, get: (r) => money(r.spending) },
    { label: 'Saved', num: true, get: (r) => signed(r.saved) },
    { label: 'Savings rate', num: true, get: (r) => (r.month === thisMonth ? '–' : pct(r.rate, 0)) },
    { label: 'Market movement', num: true, get: (r) => (r.market == null ? '–' : signed(r.market)), cls: 'muted' },
    { label: 'Net worth change', num: true, get: (r) => (r.change == null ? '–' : `${r.change > 0 ? '▲' : r.change < 0 ? '▼' : ''} ${signed(r.change)}`) },
  ], d.months, 'No transactions yet.');

  const cats = d.spending.categories, top = Math.max(1, ...cats.map((c) => Math.max(c.last30, c.average)));
  const total = (k) => cats.reduce((s, c) => s + c[k], 0);
  table($('ins-categories'), [
    { label: 'Category', get: (r) => r.category },
    { label: 'Last 30 days (line marks the average)', get: (r) => (r.total ? '' : bar(r.last30 / top, r.average / top)) },
    { label: 'Last 30 days', num: true, get: (r) => money(r.last30) },
    { label: 'Previous 30', num: true, get: (r) => money(r.prev30), cls: 'muted' },
    { label: 'Monthly average', num: true, get: (r) => money(r.average), cls: 'muted' },
    { label: 'Against average', num: true, get: (r) => (r.average ? `${r.last30 > r.average ? '▲' : '▼'} ${pct(Math.abs(r.last30 / r.average - 1), 0)}` : '–') },
  ], cats.length ? [...cats, { category: 'Total', total: true, last30: total('last30'), prev30: total('prev30'), average: total('average') }] : [], 'No spending yet.');

  table($('ins-merchants'), [
    { label: 'Payee', get: (r) => title(r.merchant) },
    { label: 'Category', get: (r) => r.category, cls: 'muted' },
    { label: 'Payments', num: true, get: (r) => String(r.count), cls: 'muted' },
    { label: 'Total', num: true, get: (r) => money(r.total) },
  ], d.spending.merchants, 'No spending yet.');

  const every = { month: 'Monthly', 'half month': 'Twice a month', week: 'Weekly' };
  const status = (r) => r.status === 'active' ? '' : tag(r.status === 'price change' ? `Price changed, ${r.note.replace(/^was ([\d.]+)/, (m, a) => 'was ' + money(Number(a)))}`
    : r.status === 'new' ? `New, first charged ${shortDate(r.note.slice(-10))}` : `Stopped, last seen ${shortDate(r.note.slice(-10))}`);
  $('ins-recurring-total').textContent = d.recurring.length ? `${money(d.recurringAnnual)} a year across ${active.length} active` : '';
  table($('ins-recurring'), [
    { label: 'Payee', get: (r) => [title(r.merchant), status(r)], cls: 'wrap' },
    { label: 'Paid from', get: (r) => r.account, cls: 'muted' },
    { label: 'How often', get: (r) => every[r.cadence], cls: 'muted' },
    { label: 'Amount', num: true, get: (r) => (r.variable ? '≈ ' : '') + money(r.amount) },
    { label: 'Per year', num: true, get: (r) => (r.status === 'stopped' ? '–' : money(r.annual)) },
    { label: 'Next expected', get: (r) => (r.status === 'stopped' ? '–' : shortDate(r.next)), cls: 'muted' },
  ], d.recurring, 'Nothing recurring found yet. It takes about three months of history.');

  const rw = d.runway;
  $('ins-runway-head').textContent = rw ? `${rw.account}: ${money(rw.balance)} today. Lowest point in the next ${rw.days} days is ${money(rw.low.balance)} on ${shortDate(rw.low.date)}${rw.warn ? `, below your ${money(rw.threshold)} line.` : '.'}` : '';
  table($('ins-runway'), [
    { label: 'Date', get: (r) => shortDate(r.date), cls: 'muted' },
    { label: 'Expected', get: (r) => title(r.label) },
    { label: 'Amount', num: true, get: (r) => signed(r.amount) },
    { label: 'Balance after', num: true, get: (r) => (r.balance < rw.threshold ? '⚠ ' : '') + money(r.balance) },
  ], rw?.events ?? [], 'Nothing expected in the next 45 days.');

  const al = d.allocation, scale = Math.max(0.01, ...al.classes.map((c) => Math.max(c.share, c.target ?? 0)));
  $('ins-allocation-total').textContent = al.total ? `${money(al.total)} in investment and retirement accounts. The line marks your target.` : '';
  table($('ins-allocation'), [
    { label: 'Asset class', get: (r) => r.name },
    { label: 'Share of portfolio', get: (r) => bar(r.share / scale, r.target == null ? null : r.target / scale) },
    { label: 'Value', num: true, get: (r) => money(r.value) },
    { label: 'Share', num: true, get: (r) => pct(r.share) },
    { label: 'Target', num: true, get: (r) => pct(r.target, 0), cls: 'muted' },
    { label: 'To reach target', num: true, get: (r) => (r.target == null ? '–' : signed((r.target - r.share) * al.total)) },
  ], al.classes.filter((c) => c.value || c.target), 'No holdings yet.');
  table($('ins-top'), [
    { label: 'Symbol', get: (r) => [r.symbol, r.single && r.share > 0.1 ? tag('Single stock over 10%') : null] },
    { label: 'Name', get: (r) => r.name ?? '', cls: 'wrap muted' },
    { label: 'Held in', num: true, get: (r) => `${r.accounts} account${r.accounts === 1 ? '' : 's'}`, cls: 'muted' },
    { label: 'Value', num: true, get: (r) => money(r.value) },
    { label: 'Share', num: true, get: (r) => pct(r.share) },
  ], al.top, 'No holdings yet.');

  table($('ins-anomalies'), [
    { label: 'Date', get: (r) => shortDate(r.date), cls: 'muted' },
    { label: 'What', get: (r) => r.kind },
    { label: 'Transaction', get: (r) => [title(r.description), el('div', { class: 'muted' }, r.note.replace(/about ([\d.]+)/, (m, a) => 'about ' + money(Number(a))))], cls: 'wrap' },
    { label: 'Account', get: (r) => r.account, cls: 'muted' },
    { label: 'Amount', num: true, get: (r) => signed(r.amount) },
  ], d.anomalies, 'Nothing looks out of place.');

  const fact = (label, value) => el('div', {}, el('span', {}, label), el('strong', {}, value));
  $('ins-loans').replaceChildren(...d.debt.loans.flatMap((l) => {
    const head = el('div', { class: 'loan' }, fact(l.name, money(l.balance)), fact('Interest rate', l.rate ? pct(l.rate, 2) : '–'),
      fact('Principal + interest', l.payment ? `${money(l.payment)} a month` : '–'), fact('Paid off', l.payoff ? monthYear(l.payoff) : '–'), fact('Interest still to pay', l.interestRemaining ? money(l.interestRemaining) : '–'));
    if (!l.scenarios.length) return [head];
    const box = el('div', { class: 'scroll' });
    table(box, [
      { label: 'If you pay extra each month', get: (r) => `${money(r.extra, { maximumFractionDigits: 0 })} more` },
      { label: 'Paid off', get: (r) => monthYear(r.payoff) },
      { label: 'Sooner by', get: (r) => `${Math.floor(r.monthsSaved / 12)} yr ${r.monthsSaved % 12} mo`, cls: 'muted' },
      { label: 'Interest saved', num: true, get: (r) => money(r.interestSaved) },
    ], l.scenarios, '');
    return [head, box];
  }));
  table($('ins-cards'), [
    { label: 'Card', get: (r) => r.name },
    { label: 'Share of limit used', get: (r) => (r.utilization == null ? '' : bar(r.utilization)) },
    { label: 'Balance', num: true, get: (r) => money(r.balance) },
    { label: 'Limit', num: true, get: (r) => money(r.limit), cls: 'muted' },
    { label: 'Used', num: true, get: (r) => pct(r.utilization, 0) },
  ], d.debt.cards, 'No credit cards.');
};

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  for (const b of $('tabs').children) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  $('tab-overview').hidden = tab !== 'overview';
  $('tab-insights').hidden = tab !== 'insights';
  if (tab === 'overview') drawChart(); else window.redrawCharts();
});
