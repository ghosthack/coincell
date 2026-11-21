// Everything on the Insights tab, computed from what the scrapers stored.
// Rules you can change live in insights-config.json (categories, asset classes,
// allocation targets, low-balance warning level, extra-payment scenarios).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DEMO, today } from './paths.js';
import { getAccounts, getHoldings, getNetWorth, allTransactions } from './db.js';

const DAY = 86_400_000;
const r2 = (n) => Math.round(n * 100) / 100;
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const addMonths = (iso, n = 1) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, dim))).toISOString().slice(0, 10);
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const liquid = (type) => type === 'cash' || type === 'credit';

function loadConfig() {
  const file = DEMO ? path.join(ROOT, 'fakebanks', 'insights-config.json') : path.join(ROOT, 'insights-config.json');   // the demo has its own rules
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { lowBalance: 1000, emergencyMonths: 6, extraPayments: [100, 250, 500], returns: { low: 0.03, mid: 0.05, high: 0.07 }, allocationTargets: {}, assetClasses: {}, assetTypes: {}, categories: [], ...cfg };
}

/** "GREENLEAF GROCERY #114" -> "GREENLEAF GROCERY"; "AMAZON MKTP US, SEATTLE WA" -> "AMAZON MKTP US" */
export const merchant = (desc) => desc.toUpperCase().replace(/,.*$/, '').replace(/••\d+/g, ' ').replace(/[#*]\S*/g, ' ')
  .replace(/\b\d{3,}\b/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * What a transaction means for the household as a whole. Moves between own
 * accounts are nothing; a mortgage payment is spending except for its principal;
 * money arriving in a retirement or investment account from outside (payroll
 * deductions, employer match) is a contribution.
 */
function classify(t) {
  if (liquid(t.account_type)) {
    if (!t.transfer_id) return t.amount > 0 ? { income: t.amount } : { spending: -t.amount };
    if (t.amount < 0 && t.other_type === 'loan') {
      const principal = Math.min(t.other_principal ?? -t.amount, -t.amount);
      return { spending: -t.amount - principal, loanCost: true, principal };
    }
    return {};
  }
  if ((t.account_type === 'investment' || t.account_type === 'retirement') && !t.transfer_id && t.amount > 0 && /^(Contribution|Deposit)$/.test(t.category ?? '')) return { contribution: t.amount };
  return {};
}

// ---------- 1 + 2: savings rate, and why net worth changed ----------
function monthly(txns, networth) {
  const months = new Map();
  const flows = [];
  for (const t of txns) {
    const c = classify(t);
    const net = (c.income ?? 0) - (c.spending ?? 0) + (c.contribution ?? 0);
    if (!net && !c.spending) continue;
    flows.push({ date: t.date, net });
    const key = t.date.slice(0, 7);
    const m = months.get(key) ?? { month: key, income: 0, spending: 0, contributions: 0, principal: 0 };
    months.set(key, m);
    m.income += c.income ?? 0; m.spending += c.spending ?? 0; m.contributions += c.contribution ?? 0; m.principal += c.principal ?? 0;
  }
  const rows = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  for (const m of rows) {
    m.saved = m.income + m.contributions - m.spending;
    m.rate = m.income + m.contributions > 0 ? m.saved / (m.income + m.contributions) : null;
    // Net worth at the end of the previous month (or the first day we know) to the end of this one.
    const inMonth = networth.filter((p) => p.date.startsWith(m.month));
    const before = networth.filter((p) => p.date < `${m.month}-01`).at(-1);
    const start = before ?? inMonth[0], end = inMonth.at(-1);
    if (start && end) {
      const savedInWindow = flows.filter((f) => f.date > start.date && f.date <= end.date).reduce((s, f) => s + f.net, 0);
      Object.assign(m, { start: start.value, end: end.value, change: end.value - start.value, market: end.value - start.value - savedInWindow, partialStart: !before });
    }
  }
  const full = rows.filter((m) => m.month < today().slice(0, 7)).slice(0, 3);
  const inc = full.reduce((s, m) => s + m.income + m.contributions, 0);
  const avg = (k) => full.reduce((s, m) => s + m[k], 0) / full.length;
  return { months: rows, trailing: full.length && inc ? { months: full.length, rate: full.reduce((s, m) => s + m.saved, 0) / inc, saved: avg('saved'), spending: avg('spending'), principal: avg('principal') } : null };
}

// ---------- 3: spending by category and merchant ----------
function spending(txns, cfg) {
  const rules = cfg.categories.map((r) => ({ category: r.category, re: new RegExp(r.match, 'i') }));
  const items = [];
  for (const t of txns) {
    const c = classify(t);
    if (!c.spending) continue;
    items.push(c.loanCost
      ? { date: t.date, amount: c.spending, category: 'Housing', merchant: 'MORTGAGE INTEREST & ESCROW' }
      : { date: t.date, amount: c.spending, category: rules.find((r) => r.re.test(t.description))?.category ?? t.category ?? 'Other', merchant: merchant(t.description) });
  }
  const now = today(), d30 = addDays(now, -30), d60 = addDays(now, -60), d90 = addDays(now, -90);
  const cats = new Map();
  for (const i of items) {
    if (i.date <= d90) continue;
    const c = cats.get(i.category) ?? { category: i.category, last30: 0, prev30: 0, average: 0 };
    cats.set(i.category, c);
    if (i.date > d30) c.last30 += i.amount; else if (i.date > d60) c.prev30 += i.amount;
    c.average += i.amount / 3;
  }
  const merchants = new Map();
  for (const i of items) {
    if (i.date <= d90) continue;
    const m = merchants.get(i.merchant) ?? { merchant: i.merchant, category: i.category, total: 0, count: 0 };
    merchants.set(i.merchant, m);
    m.total += i.amount; m.count++;
  }
  return { categories: [...cats.values()].sort((a, b) => b.last30 - a.last30), merchants: [...merchants.values()].sort((a, b) => b.total - a.total).slice(0, 10) };
}

// ---------- 4: recurring payments ----------
const CADENCES = [{ name: 'month', lo: 26, hi: 35, perYear: 12 }, { name: 'half month', lo: 12, hi: 18, perYear: 24 }, { name: 'week', lo: 6, hi: 8, perYear: 52 }];

function findSeries(txns) {
  const groups = new Map();
  for (const t of txns) {
    if (!liquid(t.account_type)) continue;
    const key = `${t.account_id}|${merchant(t.description)}|${t.amount < 0 ? '-' : '+'}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const now = today(), out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const gaps = list.slice(1).map((t, i) => dayNum(t.date) - dayNum(list[i].date));
    const cadence = CADENCES.find((c) => gaps.every((g) => g >= c.lo && g <= c.hi));
    if (!cadence) continue;
    const amounts = list.map((t) => Math.abs(t.amount)), mid = median(amounts);
    if ((Math.max(...amounts) - Math.min(...amounts)) / mid > 0.5) continue; // too irregular to be a bill
    if (cadence.name === 'month') { const doms = list.map((t) => Number(t.date.slice(8))); if (Math.max(...doms) - Math.min(...doms) > 4) continue; }
    const first = list[0], last = list.at(-1);
    const isNew = dayNum(now) - dayNum(first.date) <= 75;
    if (list.length < 3 && !isNew) continue;
    const variable = (Math.max(...amounts) - Math.min(...amounts)) / mid > 0.02;
    const amount = variable ? r2(amounts.slice(-3).reduce((s, a) => s + a, 0) / Math.min(3, amounts.length)) : amounts.at(-1);
    const next = cadence.name === 'month' ? addMonths(last.date) : addDays(last.date, Math.round(median(gaps)));
    const prev = amounts.at(-2);
    let status = 'active', note = '';
    if (dayNum(now) > dayNum(next) + 10) { status = 'stopped'; note = `last seen ${last.date}`; }
    else if (isNew) { status = 'new'; note = `first charged ${first.date}`; }
    else if (amounts.slice(0, -1).every((a) => Math.abs(a - prev) < 0.005 * prev + 0.005) && Math.abs(amounts.at(-1) - prev) > 0.01 * prev) { status = 'price change'; note = `was ${prev.toFixed(2)}`; }
    else if (list.length >= 3 && Math.abs(prev - amounts.at(-3)) > 0.01 * prev && Math.abs(amounts.at(-1) - prev) < 0.005 && amounts.slice(0, -2).every((a) => Math.abs(a - amounts[0]) < 0.005)) { status = 'price change'; note = `was ${amounts.at(-3).toFixed(2)} until ${list.at(-3).date.slice(0, 7)}`; }
    const priced = status === 'price change';
    out.push({ account_id: last.account_id, account: last.account_name, merchant: merchant(last.description), sign: last.amount < 0 ? -1 : 1, cadence: cadence.name, perYear: cadence.perYear,
      gap: Math.round(median(gaps)), count: list.length, amount: priced ? amounts.at(-1) : amount, variable: variable && !priced, annual: r2((priced ? amounts.at(-1) : amount) * cadence.perYear), lastDate: last.date, next, status, note,
      transfer: Boolean(last.transfer_id), other_type: last.other_type ?? null, other_account: last.other_account ?? null });
  }
  return out;
}

// ---------- 5: cash runway ----------
function runway(series, accounts, cfg) {
  const cash = accounts.filter((a) => a.type === 'cash');
  if (!cash.length) return null;
  const count = (a) => series.filter((s) => s.account_id === a.id).length;
  const acct = cash.reduce((best, a) => (count(a) > count(best) ? a : best)); // the account the bills run through
  const now = today(), end = addDays(now, 45), events = [];
  for (const s of series) {
    if (s.account_id !== acct.id || s.status === 'stopped' || s.other_type === 'credit' || s.other_type === 'loan') continue;
    for (let d = s.next; d <= end; d = s.cadence === 'month' ? addMonths(d) : addDays(d, s.gap)) {
      if (d > now) events.push({ date: d, label: s.merchant + (s.variable ? ' (estimate)' : ''), amount: s.sign * s.amount });
    }
  }
  for (const a of accounts) { // what the cards and loans themselves say is due
    if (!(a.due_amount > 0) || !a.due_date) continue;
    for (let d = a.due_date < now ? now : a.due_date, i = 0; d <= end && i < (a.type === 'loan' ? 3 : 1); d = addMonths(d), i++) {
      events.push({ date: d, label: `${a.name} payment${i ? ' (following month)' : ''}`, amount: -a.due_amount });
    }
  }
  events.sort((x, y) => x.date.localeCompare(y.date) || y.amount - x.amount);
  let balance = acct.balance, low = { date: now, balance };
  for (const e of events) { balance = r2(balance + e.amount); e.balance = balance; if (balance < low.balance) low = { date: e.date, balance }; }
  return { account: acct.name, balance: acct.balance, days: 45, threshold: cfg.lowBalance, low, warn: low.balance < cfg.lowBalance, events };
}

// ---------- 6: asset allocation ----------
function allocation(holdings, cfg) {
  const classes = new Map(), symbols = new Map();
  let total = 0;
  for (const h of holdings) {
    total += h.value;
    const rule = cfg.assetClasses[h.symbol];
    // A symbol's own rule wins; otherwise the kind of security the institution reported ("Equity",
    // "Mutual Fund"), renamed through assetTypes if you have set that; otherwise Unclassified.
    const fallback = h.symbol === 'CASH' ? 'Cash' : h.asset_type ? cfg.assetTypes[h.asset_type] ?? h.asset_type : 'Unclassified';
    const mix = rule?.mix ?? { [rule?.class ?? fallback]: 1 };
    for (const [name, share] of Object.entries(mix)) classes.set(name, (classes.get(name) ?? 0) + h.value * share);
    const s = symbols.get(h.symbol) ?? { symbol: h.symbol, name: h.name, value: 0, accounts: 0, single: Boolean(rule?.single) };
    symbols.set(h.symbol, s);
    s.value += h.value; s.accounts++;
  }
  // A negative cash position is money borrowed against the account (margin), so say that.
  if ((classes.get('Cash') ?? 0) < 0) { classes.set('Borrowed on margin', classes.get('Cash')); classes.delete('Cash'); }
  for (const name of Object.keys(cfg.allocationTargets)) if (!classes.has(name)) classes.set(name, 0);
  return {
    total,
    classes: [...classes].map(([name, value]) => ({ name, value, share: total ? value / total : 0, target: cfg.allocationTargets[name] != null ? cfg.allocationTargets[name] / 100 : null })).sort((a, b) => b.value - a.value),
    top: [...symbols.values()].map((s) => ({ ...s, share: total ? s.value / total : 0 })).sort((a, b) => b.value - a.value).slice(0, 8),
  };
}

// ---------- 7: things that look wrong ----------
function anomalies(txns, accounts) {
  const now = today(), recent = addDays(now, -45), out = [];
  const spend = txns.filter((t) => liquid(t.account_type) && !t.transfer_id && t.amount < 0);
  const byMerchant = new Map();
  for (const t of spend) { const k = merchant(t.description); byMerchant.set(k, [...(byMerchant.get(k) ?? []), t]); }
  for (const [name, list] of byMerchant) {
    const mid = median(list.map((t) => -t.amount));
    for (const t of list) {
      const others = list.filter((x) => x !== t).map((x) => -x.amount);
      if (t.date > recent && list.length >= 4 && -t.amount > 3 * mid && -t.amount > 1.5 * Math.max(...others)) {
        out.push({ date: t.date, kind: 'Unusually large', account: t.account_name, description: t.description, amount: t.amount, note: `Usually about ${mid.toFixed(2)} at ${name} (${list.length} charges on record)` });
      }
    }
    // Two identical charges on one day are suspicious once, but not from a payee where that happens
    // routinely (a commuter fare, a daily coffee).
    const twins = list.filter((b, i) => i > 0 && list[i - 1].account_id === b.account_id && list[i - 1].amount === b.amount && dayNum(b.date) - dayNum(list[i - 1].date) <= 1).length;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (twins <= 2 && b.date > recent && a.account_id === b.account_id && a.amount === b.amount && -b.amount >= 10 && dayNum(b.date) - dayNum(a.date) <= 1) {
        out.push({ date: b.date, kind: 'Possible duplicate', account: b.account_name, description: b.description, amount: b.amount, note: `Same amount charged twice${a.date === b.date ? ' on the same day' : ' on consecutive days'}` });
      }
    }
  }
  for (const t of spend) {
    if (t.date > addDays(now, -90) && /\bFEE\b|INTEREST CHARGE|OVERDRAFT|LATE CHARGE/i.test(t.description)) {
      out.push({ date: t.date, kind: 'Fee', account: t.account_name, description: t.description, amount: t.amount, note: 'Fees and interest are often avoidable or refundable on request' });
    }
  }
  // Money sent to one of your own institutions that never showed up on the other side.
  for (const t of spend) {
    if (t.date > addDays(now, -5) || t.date <= addDays(now, -60)) continue;
    const d = t.description.toLowerCase();
    const target = accounts.find((a) => a.id !== t.account_id && (d.includes(a.bank.toLowerCase()) || (a.mask && d.includes(a.mask))));
    if (target) out.push({ date: t.date, kind: 'Payment not received', account: t.account_name, description: t.description, amount: t.amount, note: `Left this account but no matching credit has appeared at ${target.name}` });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- 8: debt ----------
function debt(accounts, txns, cfg) {
  const loans = accounts.filter((a) => a.type === 'loan').map((a) => {
    const lastPayment = txns.filter((t) => t.account_id === a.id && t.principal != null).at(-1);
    const loan = { name: a.name, balance: -a.balance, rate: a.rate, scenarios: [] };
    if (!a.rate || !lastPayment) return loan;
    const monthlyRate = a.rate / 12;
    loan.payment = r2(lastPayment.principal + (-a.balance + lastPayment.principal) * monthlyRate); // principal + interest, without escrow
    const run = (extra) => {
      let bal = -a.balance, months = 0, interest = 0;
      const points = [{ months: 0, balance: r2(bal) }];
      while (bal > 0.005 && months < 720) { const i = bal * monthlyRate; interest += i; bal -= loan.payment + extra - i; months++; if (months % 6 === 0 || bal <= 0.005) points.push({ months, balance: r2(Math.max(0, bal)) }); }
      return { months, interest: r2(interest), payoff: addMonths(a.due_date ?? today(), months - 1), points };
    };
    const base = run(0);
    Object.assign(loan, { payoff: base.payoff, monthsLeft: base.months, interestRemaining: base.interest, start: a.due_date ?? today(), points: base.points });
    loan.scenarios = cfg.extraPayments.map((extra) => { const s = run(extra); return { extra, payoff: s.payoff, monthsSaved: base.months - s.months, interestSaved: r2(base.interest - s.interest), points: s.points }; });
    return loan;
  });
  const cards = accounts.filter((a) => a.type === 'credit').map((a) => ({ name: a.name, balance: -a.balance, limit: a.credit_limit, utilization: a.credit_limit ? -a.balance / a.credit_limit : null }));
  const withLimit = cards.filter((c) => c.limit);
  const limit = withLimit.reduce((s, c) => s + c.limit, 0);
  return { loans, cards, utilization: limit ? withLimit.reduce((s, c) => s + c.balance, 0) / limit : null };
}

// ---------- charts: where a month's money went, and spending per day ----------
function spendItems(txns, cfg) {
  const rules = cfg.categories.map((r) => ({ category: r.category, re: new RegExp(r.match, 'i') }));
  const items = [];
  for (const t of txns) {
    const c = classify(t);
    if (!c.spending) continue;
    items.push({ date: t.date, amount: c.spending, merchant: c.loanCost ? 'MORTGAGE INTEREST & ESCROW' : merchant(t.description),
      category: c.loanCost ? 'Housing' : rules.find((r) => r.re.test(t.description))?.category ?? t.category ?? 'Other' });   // your rules, then the bank's own category
  }
  return items;
}

function moneyFlow(txns, cfg, months) {
  const month = (months.find((m) => m.month < today().slice(0, 7)) ?? months[0])?.month;
  if (!month) return null;
  const inMonth = txns.filter((t) => t.date.startsWith(month));
  const add = (map, k, v) => map.set(k, (map.get(k) ?? 0) + v);
  const sources = new Map(), spend = new Map();
  let contributions = 0, invested = 0, principal = 0;
  for (const t of inMonth) {
    const c = classify(t);
    if (c.income) add(sources, merchant(t.description), c.income);
    if (c.contribution) contributions += c.contribution;
    if (c.principal) principal += c.principal;
    if (liquid(t.account_type) && t.transfer_id && t.amount < 0 && (t.other_type === 'investment' || t.other_type === 'retirement')) invested -= t.amount;
  }
  if (contributions) sources.set('RETIREMENT CONTRIBUTIONS & MATCH', contributions);
  for (const i of spendItems(inMonth, cfg)) add(spend, i.category, i.amount);
  const list = (map) => [...map].map(([name, value]) => ({ name, value: r2(value) })).sort((a, b) => b.value - a.value);
  let spending = list(spend);
  if (spending.length > 8) spending = [...spending.slice(0, 7), { name: 'Everything else', value: r2(spending.slice(7).reduce((s, x) => s + x.value, 0)) }];
  const income = [...sources.values()].reduce((s, v) => s + v, 0), spent = spending.reduce((s, x) => s + x.value, 0);
  const kept = r2(income - spent - contributions - invested - principal); // change in cash, net of card balances
  const saving = [{ name: 'Retirement accounts', value: contributions }, { name: 'Investments', value: invested }, { name: 'Mortgage principal', value: r2(principal) }, { name: 'Kept in cash', value: Math.max(0, kept) }].filter((x) => x.value > 0);
  if (kept < 0) sources.set('DRAWN FROM CASH', -kept);
  return { month, sources: list(sources), spending, saving };
}

function dailySpending(txns, cfg) {
  const now = today(), first = txns[0]?.date ?? now;
  let start = addDays(now, -181);
  if (start < first) start = first;
  const days = new Map();
  for (let d = start; d <= now; d = addDays(d, 1)) days.set(d, { date: d, total: 0, count: 0, top: null });
  for (const i of spendItems(txns, cfg)) {
    const d = days.get(i.date);
    if (!d) continue;
    d.total = r2(d.total + i.amount); d.count++;
    if (!d.top || i.amount > d.top.amount) d.top = { merchant: i.merchant, amount: i.amount };
  }
  return [...days.values()];
}

// ---------- chart: when investments could cover spending ----------
function projection(accounts, trailing, cfg) {
  if (!trailing) return null;
  const start = accounts.filter((a) => ['cash', 'investment', 'retirement'].includes(a.type)).reduce((s, a) => s + a.balance, 0);
  const monthly = Math.max(0, trailing.saved - trailing.principal); // mortgage principal is saved, but not investable
  const annualSpending = trailing.spending * 12, target = annualSpending * 25;
  const value = (rate, years) => { const m = rate / 12, n = years * 12; return start * (1 + m) ** n + (m ? monthly * (((1 + m) ** n - 1) / m) : monthly * n); };
  const thisYear = Number(today().slice(0, 4)), years = [], reach = {};
  for (let y = 0; y <= 50; y++) {
    const p = { year: thisYear + y };
    for (const [k, rate] of Object.entries(cfg.returns)) { p[k] = r2(value(rate, y)); if (reach[k] == null && p[k] >= target) reach[k] = thisYear + y; }
    years.push(p);
  }
  return { start: r2(start), monthly: r2(monthly), annualSpending: r2(annualSpending), target: r2(target), returns: cfg.returns, reach, years };
}

// ---------- suggestions: plain sentences from the numbers above ----------
function advice(d, accounts, cfg) {
  const $ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const out = [];
  const say = (tone, title, text) => out.push({ tone, title, text });
  const dupes = d.anomalies.filter((x) => x.kind === 'Possible duplicate');
  if (dupes.length === 1) say('action', 'Dispute a possible duplicate charge', `${dupes[0].description} charged ${$(-dupes[0].amount)} twice on ${dupes[0].account}. If only one was intended, ask the card issuer to reverse the other.`);
  else if (dupes.length) say('action', 'Check possible duplicate charges', `${dupes.length} charges look doubled (${$(dupes.reduce((s, a) => s - a.amount, 0))} in total), the largest being ${dupes.sort((a, b) => a.amount - b.amount)[0].description}. They are listed under "Worth a second look".`);
  for (const a of d.anomalies.filter((x) => x.kind === 'Payment not received')) say('action', 'Chase a payment that has not arrived', `${a.description} (${$(-a.amount)}) left ${a.account} on ${a.date} with no matching credit on the other side.`);
  if (d.runway?.warn) say('action', 'Top up before a low point', `${d.runway.account} is projected to reach ${$(d.runway.low.balance)} on ${d.runway.low.date}, below your ${$(d.runway.threshold)} line. Moving ${$(d.runway.threshold - d.runway.low.balance)} in beforehand covers it.`);
  const cash = accounts.filter((a) => a.type === 'cash').reduce((s, a) => s + a.balance, 0);
  if (d.trailing?.spending > 0) {
    const monthsHeld = cash / d.trailing.spending, goal = cfg.emergencyMonths * d.trailing.spending;
    if (monthsHeld > cfg.emergencyMonths + 1) say('idea', 'Cash above your emergency target', `Cash covers ${monthsHeld.toFixed(1)} months of spending against a ${cfg.emergencyMonths}-month target. About ${$(cash - goal)} could be invested or put toward the mortgage.`);
    else if (monthsHeld < cfg.emergencyMonths) say(monthsHeld < 3 ? 'action' : 'idea', 'Emergency fund is short of target', `Cash covers ${monthsHeld.toFixed(1)} months of spending; your target is ${cfg.emergencyMonths}. That is ${$(goal - cash)} short. At the current pace of saving it takes about ${Math.ceil((goal - cash) / Math.max(1, d.trailing.saved - d.trailing.principal))} months to close if new savings go to cash first.`);
    else say('good', 'Emergency fund is on target', `Cash covers ${monthsHeld.toFixed(1)} months of spending.`);
  }
  const drift = d.allocation.classes.filter((c) => c.target != null).map((c) => ({ ...c, gap: c.share - c.target }));
  const over = drift.filter((c) => c.gap > 0.03).sort((a, b) => b.gap - a.gap)[0], under = drift.filter((c) => c.gap < -0.03 && c.name !== 'Cash').sort((a, b) => a.gap - b.gap)[0];
  if (over && under) {
    const deposit = d.flow?.saving.find((s) => s.name === 'Investments')?.value;
    say('idea', 'Rebalance with new money', `${over.name} is ${(over.gap * 100).toFixed(0)} points over target and ${under.name} is ${(-under.gap * 100).toFixed(0)} points under (${$(-under.gap * d.allocation.total)}).`
      + (deposit ? ` Pointing the ${$(deposit)} monthly deposit at ${under.name} closes the gap gradually without selling anything.` : ' Directing new deposits there closes the gap without selling.'));
  }
  for (const h of d.allocation.top.filter((x) => x.single && x.share > 0.1)) say('idea', 'One stock is a large share', `${h.symbol} is ${(h.share * 100).toFixed(0)}% of your investments.`);
  const changed = d.recurring.filter((r) => r.status === 'price change' || r.status === 'new');
  if (changed.length) say('idea', 'Subscriptions changed', `${changed.map((r) => `${r.merchant} (${r.status === 'new' ? 'new' : 'price went up'}, ${$(r.annual)} a year)`).join('; ')}. Worth confirming each is still wanted.`);
  const fees = d.anomalies.filter((x) => x.kind === 'Fee');
  if (fees.length) say('idea', 'Fees paid recently', `${fees.length} fee${fees.length === 1 ? '' : 's'} totalling ${$(fees.reduce((s, f) => s - f.amount, 0))}: ${fees.map((f) => f.description).join(', ')}. Account maintenance fees can often be waived by asking or by switching account type.`);
  if (d.debt.utilization > 0.3) say('action', 'Card balances are high against limits', `You are using ${(d.debt.utilization * 100).toFixed(0)}% of your card limits. Staying under 30% generally helps a credit score.`);
  for (const l of d.debt.loans) {
    const s = l.scenarios[Math.floor(l.scenarios.length / 2)];
    if (s) say('idea', 'Extra mortgage payments go a long way', `Adding ${$(s.extra)} a month to ${l.name} finishes it ${Math.floor(s.monthsSaved / 12)} years ${s.monthsSaved % 12} months sooner and saves ${$(s.interestSaved)} in interest. At ${(l.rate * 100).toFixed(2)}% that is a guaranteed return of the same rate; compare it with what you expect from investing instead.`);
  }
  if (d.trailing) say(d.trailing.rate >= 0.2 ? 'good' : 'idea', d.trailing.rate >= 0.2 ? 'Savings rate is strong' : 'Savings rate is below 20%', `You kept ${(d.trailing.rate * 100).toFixed(0)}% of income over the last ${d.trailing.months} full months (${$(d.trailing.saved)} a month).` + (d.projection?.reach.mid ? ` At that pace and a ${(cfg.returns.mid * 100).toFixed(0)}% real return, investments could cover your spending around ${d.projection.reach.mid}.` : ''));
  const order = { action: 0, idea: 1, good: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

export function getInsights() {
  const cfg = loadConfig();
  const txns = allTransactions(), accounts = getAccounts(), networth = getNetWorth();
  const series = findSeries(txns);
  const recurring = series.filter((s) => s.sign < 0 && !s.transfer).sort((a, b) => b.annual - a.annual);
  const d = {
    asOf: networth.at(-1)?.date ?? null,
    ...monthly(txns, networth),
    spending: spending(txns, cfg),
    recurring,
    recurringAnnual: r2(recurring.filter((s) => s.status !== 'stopped').reduce((s, x) => s + x.annual, 0)),
    runway: runway(series, accounts, cfg),
    allocation: allocation(getHoldings(), cfg),
    anomalies: anomalies(txns, accounts),
    debt: debt(accounts, txns, cfg),
  };
  d.flow = moneyFlow(txns, cfg, d.months);
  d.daily = dailySpending(txns, cfg);
  d.projection = projection(accounts, d.trailing, cfg);
  d.advice = advice(d, accounts, cfg);
  return d;
}
