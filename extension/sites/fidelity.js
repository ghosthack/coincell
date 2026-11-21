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
      out.push({ acct: here, symbol: node.symbol, value, assetType: typeof node.securityType === 'string' ? node.securityType : undefined, name: [node.securityDescription, node.securityDesc, node.symbolDesc, node.description, node.desc, node.securityDetail?.desc].find((v) => typeof v === 'string' && v),
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
    { go: '/ftgw/digital/portfolio/summary', waitFor: [/\/portfolio\/api\/GetContext/], alsoWait: [/\/portfolio\/api\/GetPositions$/, /\/mas\/api\/accounts-list\/info/], settle: 1500,
      // Each account's value over time. Fidelity keeps this in different places for different
      // kinds of account, and most of them only answer a request carrying the security token its
      // own pages send. So the token is taken from a request the summary page has just made, and
      // the same questions the page asks are asked for every account. Runs in the page.
      act: async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const seen = () => window.__coincellCapture ?? [];
        const person = seen().find((e) => /GetContext/.test(e.url) && e.body?.getContext?.person?.assets)?.body.getContext.person;
        if (!person) return;
        const sentWith = (name, where = /./) => seen().find((e) => where.test(e.url) && e.sent?.headers?.[name])?.sent.headers;
        const token = sentWith('x-xsrf-token') ? { 'x-xsrf-token': sentWith('x-xsrf-token')['x-xsrf-token'] } : {};
        const managedHeaders = sentWith('fid-client-app-id', /\/mas\/api\//);
        const json = { accept: 'application/json', 'content-type': 'application/json' };
        const post = async (url, headers, body) => {
          const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) }).catch(() => null);
          return res?.ok ? await res.clone().json().catch(() => null) : null;
        };
        const detail = [`token found: ${Boolean(token['x-xsrf-token'])}, managed-account headers found: ${Boolean(managedHeaders)}`];
        const history = async (range, a) => {
          const res = await fetch('/ftgw/digital/portfolio/api/BalanceHistory', { method: 'POST', credentials: 'include', headers: { ...json, ...token }, body: JSON.stringify({ range, acctList: [{ acctNum: a.acctNum, acctType: a.acctType }] }) }).catch(() => null);
          const got = res?.ok ? await res.clone().json().catch(() => null) : null, n = got?.balHistoryDetail?.balances?.length ?? 0;
          detail.push(`history ${range} for a ${a.acctType} / ${a.acctSubType} account: status ${res?.status ?? 'none'}, ${res?.headers.get('content-type') ?? 'no type'}, ${n} points${got && !n ? `, keys ${Object.keys(got).join('+')}` : ''}`);
          return n;
        };
        const valued = person.assets.filter((x) => x.acctNum && typeof x.gainLossBalanceDetail?.totalMarketVal === 'number');

        let range = null, misses = 0;
        for (const a of valued) {
          if (range) await history(range, a);
          else {
            for (const r of ['5Y', '3Y', '2Y', '1Y']) { if (await history(r, a)) { range = r; break; } await sleep(300); }
            if (!range && ++misses >= 4) break;   // the feed is not answering; do not keep asking
          }
          await sleep(350);
        }
        // Managed accounts have a chart and a positions list of their own.
        if (managedHeaders) {
          const headers = { ...json, ...token, 'fid-originating-app-id': managedHeaders['fid-originating-app-id'], 'fid-client-app-id': managedHeaders['fid-client-app-id'] };
          for (const a of valued.filter((x) => x.managedAcctDetail || /managed/i.test(`${x.acctSubType} ${x.acctSubTypeDesc}`))) {
            const now = Date.now(), threeYears = 3 * 365 * 86_400_000;
            for (const unit of [1, 1000]) {   // the dates are a count of milliseconds or of seconds; try both
              const got = await post('/ftgw/digital/mas/api/balance-card/v1/balance-chart-data', headers, { acctNum: a.acctNum, startDate: Math.round((now - threeYears) / unit), endDate: Math.round(now / unit) });
              if (got?.balances?.length) break;
            }
            await post('/ftgw/digital/mas/api/positions', headers, { ids: [a.acctNum] });
            await sleep(400);
          }
        }
        return { detail, accounts: valued.map((a) => ({ acctNum: a.acctNum, acctType: a.acctType, name: a.preferenceDetail?.name || a.acctSubTypeDesc || a.acctType })) };
      } },
    { go: '/ftgw/digital/portfolio/positions', waitFor: [/\/portfolio\/api\/GetContext/], alsoWait: [/\/poswebex\/api\/positions$/], settle: 1500 },
    { go: '/ftgw/digital/portfolio/activity', waitFor: [/\/activityapi\/api\/v1\/transactions\/history/], settle: 1500,
      // Activity, account by account. The Activity page loads about 30 days for a default set of
      // accounts, which leaves some accounts out altogether. So the page's own request is repeated
      // for each account in turn, 90 days at a time (the most the page itself offers), going back
      // about two years or until two periods in a row are empty. Runs in the page.
      act: async (shared) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const first = (window.__coincellCapture ?? []).find((e) => /transactions\/history/.test(e.url) && e.status < 400 && e.sent?.body);
        if (!first) return;
        const asked = JSON.parse(first.sent.body), dates = asked?.filter?.searchCriteriaDetail;
        if (typeof dates?.txnFromDate !== 'number' || typeof dates?.txnToDate !== 'number') return;
        const day = 86400 * (dates.txnToDate > 1e11 ? 1000 : 1);   // the site counts in seconds or in milliseconds
        // Accounts as the page itself describes them, plus any it left out, described the same way.
        const described = new Map((asked.filter.accounts ?? []).map((a) => [a.acctNum, a]));
        const everyone = [...described.values()];
        for (const a of shared?.accounts ?? []) if (!described.has(a.acctNum)) everyone.push({ acctNum: a.acctNum, acctName: a.name, acctType: a.acctType });
        for (const account of everyone) {
          let to = dates.txnToDate, empty = 0;
          for (let i = 0; i < 9 && empty < 2; i++) {
            const from = to - 90 * day, body = structuredClone(asked);
            body.filter.accounts = [account];
            Object.assign(body.filter.searchCriteriaDetail, { txnFromDate: from, txnToDate: to });
            const res = await fetch(first.url, { method: 'POST', headers: first.sent.headers, body: JSON.stringify(body), credentials: 'include' }).catch(() => null);
            if (!res?.ok) break;
            const got = await res.clone().json().catch(() => null);
            empty = got?.data?.transactions?.length ? 0 : empty + 1;
            to = from;
            await sleep(500);
          }
        }
      } },
  ],
  describe: [/\/portfolio\/api\/GetPositions$/],
  build(captured) {
    const context = captured.find((c) => /GetContext/.test(c.url) && c.body?.getContext?.person?.assets)?.body.getContext.person;
    if (!context) throw new Error('Fidelity did not send the account list');
    const accounts = new Map(), drop = [];
    for (const a of context.assets) {
      const value = a.gainLossBalanceDetail?.totalMarketVal;
      // Fidelity can show accounts you have linked from other institutions ("External"). They are
      // not Fidelity's, their debts are not marked as debts here, and connecting those
      // institutions directly would count them twice. They are left out, and removed if an
      // earlier version brought them in.
      if (a.acctType === 'External') { if (a.acctNum) drop.push(a.acctNum); continue; }
      if (!a.acctNum || typeof value !== 'number') continue;
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
    // Past values per account. The feed's dates are text in whatever style the site uses.
    const pastDate = (s) => { const t = String(s ?? ''); const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; const d = Date.parse(t); return Number.isNaN(d) ? null : today(new Date(d)); };
    let histories = 0;
    for (const c of captured) {
      const rows = /\/api\/BalanceHistory$/.test(c.url) ? c.body?.balHistoryDetail?.balances : /\/balance-chart-data$/.test(c.url) ? c.body?.balances : null;
      if (!rows?.length) continue;
      let asked; try { asked = JSON.parse(c.sent ?? '{}'); } catch { asked = {}; }
      const a = asked.acctList?.length === 1 ? accounts.get(asked.acctList[0].acctNum) : asked.acctNum ? accounts.get(asked.acctNum) : null;
      if (!a || (a.history?.length ?? 0) >= rows.length) continue;
      if (!a.history) histories++;
      a.history = rows.map((r) => ({ date: pastDate(r.date), balance: r.value })).filter((r) => r.date && typeof r.balance === 'number');
    }
    // Holdings, from three places in turn. An account keeps what the first place that knows it says.
    //   1. the rows behind the Positions table (ordinary brokerage accounts)
    //   2. a managed account's own positions list
    //   3. the positions the summary page loads, which include workplace plans
    let holdings = 0;
    const settled = new Set();
    const take = (list) => {
      const fresh = new Map();
      for (const p of list) {
        const a = accounts.get(p.acct);
        if (!a || settled.has(a) || typeof p.value !== 'number') continue;
        const cash = p.rowType === 'POSITION_CORE' || p.assetType === 'Core' || /\*\*$/.test(p.symbol) || /^(CORE|CASH)\b|MONEY MARKET/i.test(p.name ?? '');
        const symbol = cash ? 'CASH' : p.symbol, map = fresh.get(a) ?? fresh.set(a, new Map()).get(a);
        const h = map.get(symbol) ?? { symbol, name: cash ? 'Cash & money market' : p.name, quantity: 0, value: 0, price: cash ? 1 : p.price ?? null, costBasis: null, assetType: cash ? 'Cash' : p.assetType };
        map.set(symbol, h);
        h.value += p.value;
        h.quantity += cash ? p.value : p.quantity ?? 0;
        if (!cash && p.costBasis != null) h.costBasis = (h.costBasis ?? 0) + p.costBasis;
      }
      for (const [a, map] of fresh) { a.holdings = [...map.values()]; settled.add(a); holdings += a.holdings.length; }
    };
    const feed = captured.filter((c) => /\/poswebex\/api\/positions$/.test(c.url)).at(-1)?.body;
    take(feed?.rowData ? fromRows(feed) : []);
    for (const c of captured) {
      if (!/\/mas\/api\/positions$/.test(c.url) || !c.body?.topPositions) continue;
      let asked; try { asked = JSON.parse(c.sent ?? '{}'); } catch { asked = {}; }
      take(c.body.topPositions.map((p) => ({ acct: asked.ids?.[0], symbol: p.symbol || 'UNKNOWN', name: p.securityDescription, quantity: p.quantity, value: p.marketVal, price: p.quantity ? p.marketVal / p.quantity : null, assetType: p.securityType })));
    }
    for (const c of captured) {
      if (!/\/portfolio\/api\/GetPositions$/.test(c.url)) continue;
      const found = [];
      findPositions(c.body, null, found);
      take(found);
    }
    if (feed && !settled.size) { const found = []; findPositions(feed, null, found); take(found); }
    const out = [...accounts.values()];
    if (!out.length) throw new Error('Fidelity sent an account list, but none of the accounts carried a balance');
    // For the send record: one line per account saying what kind it is and what was found for it.
    const kinds = new Map(context.assets.map((x) => [x.acctNum, x]));
    const detail = out.map((a, i) => { const x = kinds.get(a.id) ?? {}; return `account ${i + 1}: ${x.acctType} / ${x.acctSubType}${x.managedAcctDetail ? ' / managed' : ''}${x.workplacePlanDetail?.planId ? ' / workplace plan' : ''}, balance ${a.balance ? 'non-zero' : 'zero'}, ${a.holdings?.length ?? 0} holdings, ${a.transactions.length} transactions, ${a.history?.length ?? 0} past values`; });
    const summaryPositions = captured.filter((c) => /\/portfolio\/api\/GetPositions$/.test(c.url));
    detail.push(`summary positions answers: ${summaryPositions.length}, accounts in them: ${summaryPositions.map((c) => (c.body?.position?.acctDetails?.acctDetail ?? []).length).join(',')}, of which known: ${summaryPositions.map((c) => (c.body?.position?.acctDetails?.acctDetail ?? []).filter((d) => accounts.has(d.acctNum)).length).join(',')}`);
    return { accounts: out, drop, detail, note: `${drop.length ? `${drop.length} linked outside accounts left out, ` : ''}${holdings} holdings, ${out.reduce((s, a) => s + a.transactions.length, 0)} transactions, past values for ${histories} accounts${skipped ? `, ${skipped} skipped for accounts without a balance` : ''}` };
  },
};
