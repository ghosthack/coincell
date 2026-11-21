// Fidelity, by capture. Opens your Positions page and your Activity page in the tab and uses the
// answers those pages receive: the account list with balances, and the activity list.
// Written from a masked recording, so the field names are known but no real values were seen.
// Holdings come from the positions feed, which is the list of rows behind the Positions table:
// account headings, positions and totals mixed together, with abbreviated field names.
import { today, parseMoney } from '../shared.js';

const ACTIONS = [
  [/^YOU BOUGHT|^REINVESTMENT|^PURCHASE|\bBOUGHT\b/i, 'Buy'],
  [/^YOU SOLD|^REDEMPTION|\bSOLD\b/i, 'Sell'],
  [/DIVIDEND|CAP GAIN|^DISTRIBUTION|RETURN OF CAPITAL/i, 'Dividend'],
  [/^INTEREST/i, 'Interest'],
  [/\bFEE\b/i, 'Fee'],
  [/FOREIGN TAX|TAX W\/H|TAX WITHHELD/i, 'Tax'],
  [/PARTIC CONTR|CO CONTR|^CONTRIBUTION/i, 'Contribution'],
  [/DIRECT DEPOSIT|FUNDS TRANSFER RECEIVED|^DEPOSIT|CHECK RECEIVED|TRANSFERRED FROM|CASH CONTRIBUTION/i, 'Deposit'],
  [/FUNDS TRANSFER PAID|TRANSFERRED TO|WITHDRAWAL|DIRECT DEBIT|BILL PAYMENT|CHECK PAID|DEBIT CARD/i, 'Withdrawal'],
];
const RETIREMENT = /\bIRA\b|ROTH|ROLLOVER|401|403|457|PENSION|\bSEP\b|RETIRE|WORKPLACE/i;
// Walk the positions feed looking for positions: objects with a symbol and a market value.
// The account they belong to is the nearest account number above them.
const number = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?[\d.]+$/.test(v) ? Number(v) : null);
function numbersIn(node, depth = 0, prefix = '', out = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 3) return out;
  for (const [k, v] of Object.entries(node)) {
    const n = number(v);
    if (n != null) out.push([`${prefix}${k}`.toLowerCase(), n, depth]); else numbersIn(v, depth + 1, `${prefix}${k}.`, out);
  }
  return out;
}
function findPositions(node, acct, out) {
  if (Array.isArray(node)) { for (const x of node) findPositions(x, acct, out); return; }
  if (!node || typeof node !== 'object') return;
  const here = [node.acctNum, node.accountNumber, node.acctNumber].find((v) => typeof v === 'string' && v) ?? acct;
  if (typeof node.symbol === 'string' && node.symbol && here) {
    const nums = numbersIn(node).sort((a, b) => a[2] - b[2]);   // prefer fields nearest the position itself
    const pick = (re) => nums.find(([path]) => re.test(path.split('.').at(-1)))?.[1] ?? null;
    const value = pick(/^(marketval|mktval|marketvalue|mktvalue|currentvalue|currentval|totalmarketval)$/);
    if (value != null) {
      out.push({ acct: here, symbol: node.symbol, value, name: [node.securityDescription, node.securityDesc, node.symbolDesc, node.description, node.desc, node.securityDetail?.desc].find((v) => typeof v === 'string' && v),
        quantity: pick(/^(quantity|qty|shares|sharequantity)$/), price: pick(/^(lastprice|price|currentprice|lastpx)$/), costBasis: pick(/^(costbasis|totalcostbasis|costbasistotal|totalcost)$/) });
      return;
    }
  }
  for (const v of Object.values(node)) findPositions(v, here, out);
}
// A cell may be a plain number, a formatted string, or an object wrapping either.
const cellNumber = (x) => {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  if (typeof x === 'string') return parseMoney(x);
  if (typeof x !== 'object' || Array.isArray(x)) return null;
  for (const k of ['value', 'val', 'raw', 'num', 'amount', 'amt', 'displayValue', 'display', 'formatted', 'text']) if (k in x) { const n = cellNumber(x[k]); if (n != null) return n; }
  return Object.values(x).find((v) => typeof v === 'number') ?? null;
};
const cellText = (x, keys) => (typeof x === 'string' ? x : x && typeof x === 'object' ? keys.map((k) => x[k]).find((v) => typeof v === 'string' && v.trim()) : undefined);

// Positions out of the table rows. Each row says what it is in `rowType`: ACCOUNT, POSITION,
// POSITION_CORE (the cash position), ACCOUNT_TOTAL, GRAND_TOTAL, SPACER and a few messages.
// Cells are { disp: "formatted text", val: number }; `sym` holds the ticker and description.
// Should the row types ever change, the fallback is any row with an account, a symbol and a
// value, checked against the feed's total for the account so total rows are not counted.
function fromRows(feed) {
  const totals = new Map((feed.acctTot ?? []).map((t) => [t.acctNum, t.currentVal ?? t.recentMarketVal]));
  const byAccount = new Map();
  const typed = feed.rowData.some((r) => /^POSITION/.test(r.rowType ?? ''));
  for (const r of feed.rowData) {
    if (typed && !/^POSITION/.test(r.rowType ?? '')) continue;
    const acct = r.actNum ?? r.meta?.acctActns?.actNum, value = cellNumber(r.curVal);
    const symbol = cellText(r.sym, ['symbol', 'sym', 'ticker', 'name', 'displayValue', 'value'])?.trim();
    if (!acct || !symbol || value == null) continue;
    const row = { acct, symbol, value, rowType: r.rowType, assetType: [r.meta?.securityType, r.meta?.holdingType].find((v) => typeof v === 'string' && v.trim()), quantity: cellNumber(r.qty), price: cellNumber(r.lstPrc), costBasis: cellNumber(r.cstBasTot),
      name: cellText(r.sym, ['desc', 'description', 'secDesc', 'longName', 'securityDescription', 'subName', 'title']) ?? cellText(r.desc, ['name', 'value', 'displayValue']) };
    byAccount.set(acct, [...(byAccount.get(acct) ?? []), row]);
  }
  const out = [];
  for (const [acct, rows] of byAccount) {
    const total = totals.get(acct), sum = (list) => list.reduce((s, r) => s + r.value, 0);
    const close = (a) => typeof total === 'number' && Math.abs(a - total) <= Math.max(1, Math.abs(total) * 0.005);
    let keep = rows;
    if (typeof total === 'number' && !close(sum(rows))) {
      const withoutTotals = rows.filter((r) => !(Math.abs(r.value - total) < 0.011 && r.quantity == null) && !/total/i.test(r.symbol));
      const types = [...new Set(rows.map((r) => r.rowType))].map((t) => rows.filter((r) => r.rowType === t));
      keep = close(sum(withoutTotals)) ? withoutTotals : types.find((list) => close(sum(list))) ?? withoutTotals;
    }
    out.push(...keep);
  }
  return out;
}
const isoDate = (n) => today(new Date(n < 1e11 ? n * 1000 : n));   // seconds or milliseconds since 1970

export default {
  loggedOut: /login|signin|logout|\/session\//i,
  steps: [
    { go: '/ftgw/digital/portfolio/positions', waitFor: [/\/portfolio\/api\/GetContext/], alsoWait: [/\/poswebex\/api\/positions$/], settle: 1500 },
    { go: '/ftgw/digital/portfolio/activity', waitFor: [/\/activityapi\/api\/v1\/transactions\/history/], settle: 1500,
      // The Activity page only loads its default range (about 30 days). To go further back, repeat
      // the page's own request, unchanged except for the dates, in 90-day steps for up to two years.
      // Runs in the page; the repeated requests are captured like any other.
      act: async () => {
        const first = (window.__coincellCapture ?? []).find((e) => /transactions\/history/.test(e.url) && e.status < 400 && e.sent?.body);
        if (!first) return;
        const asked = JSON.parse(first.sent.body), dates = asked?.filter?.searchCriteriaDetail;
        if (typeof dates?.txnFromDate !== 'number' || typeof dates?.txnToDate !== 'number') return;
        const day = 86400 * (dates.txnToDate > 1e11 ? 1000 : 1);   // the site counts in seconds or in milliseconds
        let to = dates.txnFromDate, empty = 0;
        for (let i = 0; i < 8 && empty < 2; i++) {
          const from = to - 90 * day, body = structuredClone(asked);
          Object.assign(body.filter.searchCriteriaDetail, { txnFromDate: from, txnToDate: to });
          const res = await fetch(first.url, { method: 'POST', headers: first.sent.headers, body: JSON.stringify(body), credentials: 'include' });
          if (!res.ok) break;
          const got = await res.clone().json().catch(() => null);
          empty = got?.data?.transactions?.length ? 0 : empty + 1;
          to = from;
          await new Promise((r) => setTimeout(r, 900));
        }
      } },
  ],
  describe: [/\/poswebex\/api\/positions$/],
  build(captured) {
    const context = captured.find((c) => /GetContext/.test(c.url) && c.body?.getContext?.person?.assets)?.body.getContext.person;
    if (!context) throw new Error('Fidelity did not send the account list');
    const accounts = new Map();
    for (const a of context.assets) {
      const value = a.gainLossBalanceDetail?.totalMarketVal;
      if (!a.acctNum || typeof value !== 'number') continue;   // linked outside accounts and the like carry no balance here
      accounts.set(a.acctNum, { id: a.acctNum, name: a.preferenceDetail?.name || a.acctSubTypeDesc || a.acctType || 'Fidelity account', mask: a.acctNum.slice(-4), balance: value, transactions: [],
        type: a.acctTypesIndDetail?.isRetirement || a.workplacePlanDetail?.planName || RETIREMENT.test(`${a.preferenceDetail?.name} ${a.acctSubTypeDesc} ${a.acctType}`) ? 'retirement' : 'investment' });
    }
    const seen = new Set();
    let skipped = 0;
    for (const c of captured) {
      if (!/transactions\/history/.test(c.url)) continue;
      for (const t of c.body?.data?.transactions ?? []) {
        const a = accounts.get(t.acctNum), amount = t.amtDetail?.net, date = t.dateDetail?.postedDate ?? t.date;
        const key = `${t.acctNum}|${t.txnNum}|${date}|${amount}|${t.description}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!a) { skipped++; continue; }
        if (typeof amount !== 'number' || amount === 0 || typeof date !== 'number') continue;   // share-only lines move no cash
        const description = String(t.description ?? t.shortDesc ?? '').replace(/\s+/g, ' ').trim();
        a.transactions.push({ date: isoDate(date), description, amount, category: ACTIONS.find(([re]) => re.test(description))?.[1] ?? 'Other' });
      }
    }
    const feed = captured.filter((c) => /\/poswebex\/api\/positions$/.test(c.url)).at(-1)?.body;
    const found = feed?.rowData ? fromRows(feed) : [];
    if (feed && !found.length) findPositions(feed, null, found);
    for (const p of found) {
      const a = accounts.get(p.acct);
      if (!a) continue;
      const cash = p.rowType === 'POSITION_CORE' || /\*\*$/.test(p.symbol) || /^(CORE|CASH)\b|MONEY MARKET/i.test(p.name ?? '');
      const symbol = cash ? 'CASH' : p.symbol;
      a.holdings ??= new Map();
      const h = a.holdings.get(symbol) ?? { symbol, name: cash ? 'Cash & money market' : p.name, quantity: 0, value: 0, price: cash ? 1 : p.price, costBasis: null, assetType: cash ? 'Cash' : p.assetType };
      a.holdings.set(symbol, h);
      h.value += p.value;
      h.quantity += cash ? p.value : p.quantity ?? 0;
      if (!cash && p.costBasis != null) h.costBasis = (h.costBasis ?? 0) + p.costBasis;
    }
    let holdings = 0;
    for (const a of accounts.values()) if (a.holdings) { a.holdings = [...a.holdings.values()]; holdings += a.holdings.length; }
    const out = [...accounts.values()];
    if (!out.length) throw new Error('Fidelity sent an account list, but none of the accounts carried a balance');
    return { accounts: out, note: `${holdings} holdings, ${out.reduce((s, a) => s + a.transactions.length, 0)} transactions${skipped ? `, ${skipped} skipped for accounts without a balance` : ''}` };
  },
};
