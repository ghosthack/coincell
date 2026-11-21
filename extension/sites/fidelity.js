// Fidelity, by capture. Opens your Positions page and your Activity page in the tab and uses the
// answers those pages receive: the account list with balances, and the activity list.
// Written from a masked recording, so the field names are known but no real values were seen.
// Holdings are not included yet; Fidelity delivers positions some other way.
import { today } from '../shared.js';

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
const isoDate = (n) => today(new Date(n < 1e11 ? n * 1000 : n));   // seconds or milliseconds since 1970

export default {
  loggedOut: /login|signin|logout|\/session\//i,
  steps: [
    { go: '/ftgw/digital/portfolio/positions', waitFor: [/\/portfolio\/api\/GetContext/] },
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
    const out = [...accounts.values()];
    if (!out.length) throw new Error('Fidelity sent an account list, but none of the accounts carried a balance');
    return { accounts: out, note: `${out.reduce((s, a) => s + a.transactions.length, 0)} transactions${skipped ? `, ${skipped} skipped for accounts without a balance` : ''}` };
  },
};
