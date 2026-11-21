// Citi, by capture. Loads the dashboard to learn the accounts, then opens each account's own page
// and uses the answers those pages receive, asking the same questions again for older activity.
// Written from a masked recording: field names and settings are known, no real values were seen.
// Least certain is the card's transaction list, which was empty in the recording; each send
// saves its layout (values removed) so it can be checked.
import { parseMoney, balanceHistory, today } from '../shared.js';

const TILES = /\/dashboardTiles\/accountDetails/, BROKERAGE_TILES = /\/dashboardTiles\/brokerageAccountDetails/, CARD_BALANCES = /\/cbol\/accounts\/details\/balances/;
const BANK_TXNS = /\/bankLedger\/accounts\/([^/]+)\/(transactionDetails|transactions)\//, CARD_TXNS = /\/cbol\/accounts\/([^/]+)\/transactions\/retrieve/;
const SUMMARY = /\/invest\/portfolio\/accountSummary/, HOLDINGS = /\/invest\/portfolio\/v3\/accountHoldings/, BROKERAGE_HISTORY = /\/brokerage\/accounts\/([^/]+)\/history/;
const KINDS = { CHECKING: 'checking', SAVINGS: 'savings', CREDITCARD: 'credit-card' };

/** A date in whatever style the site uses: 2026-11-20, 11/20/2026, Nov 20, 2026. */
const flexDate = (s) => {
  const t = String(s ?? '').trim(), m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : today(new Date(d));
};
const amount = (v) => (typeof v === 'number' ? v : parseMoney(v?.amount ?? v));

// ---- what each account page does once it has loaded (these run in the page) ----
const bankPage = async (shared) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = () => window.__coincellCapture ?? [];
  const own = seen().filter((e) => /\/bankLedger\/accounts\/[^/]+\/(transactionDetails|transactions)\//.test(e.url) && e.status < 400 && e.sent?.body).at(-1);
  if (!own) return;
  // The page offers a list of periods; ask for each longer one, keeping whatever answers.
  // (The list comes with the dashboard's own answers, so it is handed over from that step.)
  const periods = [...new Set([...(shared?.periods ?? []), ...seen().flatMap((e) => e.body?.searchFilterConfig?.timePeriodList ?? []).map((p) => p.key)].filter(Boolean))];
  const asked = JSON.parse(own.sent.body);
  for (const key of periods.reverse()) {
    if (key === asked.dateFilterIndicator) continue;
    const res = await fetch(own.url, { method: 'POST', headers: own.sent.headers, body: JSON.stringify({ ...asked, dateFilterIndicator: key }), credentials: 'include' }).catch(() => null);
    await sleep(500);
    if (res?.ok) break;   // the longest period that works is enough
  }
};
const cardPage = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = () => window.__coincellCapture ?? [];
  const own = seen().filter((e) => /\/cbol\/accounts\/[^/]+\/transactions\/retrieve/.test(e.url) && e.status < 400 && e.sent?.body).at(-1);
  if (!own) return;
  // Only what the page itself loads (the current period) is used. The page lists earlier periods,
  // but asking for them the obvious way was refused by Citi, and the recording has no example of
  // the page doing it. To be added once a card with activity has been recorded choosing one.
  await sleep(200);
};
const investmentPage = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = () => window.__coincellCapture ?? [];
  const holdings = seen().filter((e) => /\/invest\/portfolio\/v3\/accountHoldings/.test(e.url) && e.status < 400 && e.sent?.body).at(-1);
  if (holdings) {   // the page asks for ten holdings at a time; ask for all of them
    const asked = JSON.parse(holdings.sent.body);
    await fetch(holdings.url, { method: 'POST', headers: holdings.sent.headers, body: JSON.stringify({ ...asked, pagination: { pageNum: 1, recordsPerPage: 500 } }), credentials: 'include' }).catch(() => null);
    await sleep(500);
  }
  const history = seen().filter((e) => /\/brokerage\/accounts\/[^/]+\/history/.test(e.url) && e.status < 400).at(-1);
  if (history) {
    const more = new URL(history.url);
    more.searchParams.set('requestSize', '200');
    await fetch(more, { headers: history.sent?.headers ?? {}, credentials: 'include' }).catch(() => null);
    await sleep(500);
  }
};

export default {
  loggedOut: /\/login|signon|logout|session-?timeout/i,
  describe: [CARD_TXNS],
  steps: [{
    go: '/US/ag/dashboard/summary', timeout: 60_000,
    waitFor: [TILES], alsoWait: [BROKERAGE_TILES, CARD_BALANCES, SUMMARY], settle: 1200,
    act: async () => {   // runs in the page: hand the list of accounts on
      const seen = window.__coincellCapture ?? [];
      const tiles = seen.find((e) => /\/dashboardTiles\/accountDetails/.test(e.url) && e.body)?.body ?? {};
      const brokerage = seen.find((e) => /\/dashboardTiles\/brokerageAccountDetails/.test(e.url) && e.body)?.body ?? {};
      return { periods: [...new Set(seen.flatMap((e) => e.body?.searchFilterConfig?.timePeriodList ?? []).map((p) => p.key).filter(Boolean))], open: [
        ...(tiles.bankAccount?.accountDetails ?? []).map((a) => ({ id: a.accountId, kind: a.accountSubType })),
        ...(tiles.creditCardAccount?.accountDetails ?? []).map((a) => ({ id: a.accountId, kind: 'CREDITCARD' })),
        ...(brokerage.brokerageAccount?.brokerageAccountDetails ?? []).map((a) => ({ id: a.accountId, kind: 'INVESTMENT' })),
      ].filter((a) => a.id) };
    },
    // One more page per account, each waiting for that kind of account's own feed.
    expand: (shared) => (shared.open ?? []).map((a) => (a.kind === 'INVESTMENT'
      ? { go: `/US/ag/dashboard/investment?accountId=${encodeURIComponent(a.id)}`, waitFor: [/\/invest\/portfolio\/(v3\/accountHoldings|accountSummary)/], alsoWait: [HOLDINGS, BROKERAGE_HISTORY], act: investmentPage, settle: 1000, optional: true }
      : a.kind === 'CREDITCARD'
        ? { go: `/US/ag/dashboard/credit-card?accountId=${encodeURIComponent(a.id)}`, waitFor: [CARD_TXNS], act: cardPage, settle: 1000, optional: true }
        : KINDS[a.kind] ? { go: `/US/ag/dashboard/${KINDS[a.kind]}?accountId=${encodeURIComponent(a.id)}`, waitFor: [BANK_TXNS], act: bankPage, settle: 1000, optional: true } : null)).filter(Boolean),
  }],

  build(captured) {
    const first = (re) => captured.find((c) => re.test(c.url) && c.body)?.body;
    const tiles = first(TILES);
    if (!tiles) throw new Error('Citi did not send the list of accounts');
    const accounts = new Map();   // by the id Citi uses in its addresses, which is how answers are tied to accounts
    for (const a of tiles.bankAccount?.accountDetails ?? []) {
      const balance = amount(a.onDepositBalanceAmount) ?? amount(a.availableBalance);
      if (balance == null) continue;
      accounts.set(a.accountId, { id: `${a.accountSubType}-${a.displayAccountNumber}`, name: a.accountName || a.productName || a.accountSubType, mask: String(a.displayAccountNumber ?? '').slice(-4), type: 'cash', balance, txns: new Map() });
    }
    const ledgers = new Map((first(CARD_BALANCES)?.accountLedgerData ?? []).map((l) => [l.accountId, l.accountBalance ?? {}]));
    for (const a of tiles.creditCardAccount?.accountDetails ?? []) {
      const owed = amount(a.currentBalance), ledger = ledgers.get(a.accountId) ?? {};
      if (owed == null) continue;
      accounts.set(a.accountId, { id: `CARD-${a.displayAccountNumber}`, name: a.accountName || a.productName || 'Citi card', mask: String(a.displayAccountNumber ?? '').slice(-4), type: 'credit', balance: -owed, txns: new Map(),
        creditLimit: amount(a.creditLimitAmount) ?? amount(ledger.creditLimit), dueAmount: amount(ledger.remainingStatementBalance) ?? amount(a.lastStatementBalance), dueDate: flexDate(a.paymentDueDate?.value ?? ledger.paymentDueDate) });
    }
    for (const a of first(BROKERAGE_TILES)?.brokerageAccount?.brokerageAccountDetails ?? []) {
      const value = amount(a.totalAccountValue);
      if (value == null) continue;
      accounts.set(a.accountId, { id: `INVEST-${a.displayAccountNumber}`, name: a.accountName || a.productName || 'Citi investment account', mask: String(a.displayAccountNumber ?? '').slice(-4), type: /\bIRA\b|ROTH|RETIRE/i.test(`${a.accountName} ${a.productName}`) ? 'retirement' : 'investment', balance: value, txns: new Map() });
    }
    const invested = [...accounts.values()].filter((a) => a.id.startsWith('INVEST-'));
    const byEnding = (digits) => invested.find((a) => digits && a.id.endsWith(String(digits))) ?? (invested.length === 1 ? invested[0] : null);

    for (const c of captured) {
      if (c.status >= 400 || !c.body) continue;
      const bank = BANK_TXNS.exec(c.url), card = CARD_TXNS.exec(c.url), trades = BROKERAGE_HISTORY.exec(c.url);
      const a = accounts.get(decodeURIComponent((bank ?? card ?? trades)?.[1] ?? ''));
      if (bank && a) for (const t of c.body.accountActivity?.postedTransactions ?? []) {
        const date = flexDate(t.additionalTransactionDetails?.transactionPostedDate ?? t.transactionDate), value = amount(t.transactionAmount), id = t.transactionKey ?? t.additionalTransactionDetails?.transactionReferenceNumber;
        if (!date || value == null || !id) continue;
        a.txns.set(id, { id, date, description: String(t.transactionDescription ?? '').replace(/\s+/g, ' ').trim(), amount: /credit/i.test(t.transactionCategoryType ?? t.transactionType ?? '') ? Math.abs(value) : -Math.abs(value) });
      }
      if (card && a) {
        // The list's place in the answer is not known for certain: take posted transactions where
        // they are expected, otherwise any list of things with a date and an amount.
        const lists = [c.body.accountActivity?.postedTransactions, c.body.accountActivity?.transactions, c.body.postedTransactions, c.body.transactions].filter(Array.isArray);
        if (!lists.length) for (const v of Object.values(c.body.accountActivity ?? {})) if (Array.isArray(v) && v.some((x) => x && typeof x === 'object' && Object.keys(x).some((k) => /amount/i.test(k)) && Object.keys(x).some((k) => /date/i.test(k)))) lists.push(v);
        for (const t of lists.flat()) {
          const date = flexDate(t.additionalTransactionDetails?.transactionPostedDate ?? t.transactionPostedDate ?? t.postedDate ?? t.transactionDate ?? t.date), value = amount(t.transactionAmount ?? t.amount);
          const id = t.transactionKey ?? t.transactionReferenceNumber ?? t.referenceNumber ?? t.transactionId ?? `${date}|${value}|${t.transactionDescription ?? t.description ?? ''}`;
          if (!date || value == null || /pending/i.test(t.transactionStatus ?? '')) continue;
          const kind = t.transactionCategoryType ?? t.transactionType ?? '';
          // On a card, a purchase is money out. Where the row says credit or debit, trust that; otherwise a positive figure is a purchase.
          a.txns.set(String(id), { id: String(id), date, description: String(t.transactionDescription ?? t.merchantName ?? t.description ?? 'Card transaction').replace(/\s+/g, ' ').trim(),
            amount: /credit/i.test(kind) ? Math.abs(value) : /debit/i.test(kind) ? -Math.abs(value) : -value });
        }
      }
      if (trades && a) for (const t of c.body.brokerageAccountTransactions ?? []) {
        const date = flexDate(t.settlementDate ?? t.transactionDateTime ?? t.tradeOrderDate);
        if (!date || typeof t.netAmount !== 'number' || t.netAmount === 0) continue;
        const description = String(t.shortActivityDescription ?? t.longActivityDescription ?? 'Investment activity').replace(/\s+/g, ' ').trim();
        a.txns.set(String(t.transactionId ?? `${date}|${t.netAmount}|${description}`), { id: String(t.transactionId ?? `${date}|${t.netAmount}`), date, description, amount: t.netAmount,
          category: /^b/i.test(t.buySellIndicator ?? '') ? 'Buy' : /^s/i.test(t.buySellIndicator ?? '') ? 'Sell' : /dividend/i.test(description) ? 'Dividend' : /interest/i.test(description) ? 'Interest' : 'Other' });
      }
      if (SUMMARY.test(c.url)) for (const s of c.body.allAccountSummary ?? []) {
        const acct = byEnding(s.accountLastThree);
        const past = (s.historicalTotalAccountValues ?? []).map((h) => ({ date: flexDate(h.asOfDate), balance: h.accountTotalValue })).filter((h) => h.date && typeof h.balance === 'number');
        if (acct && past.length > (acct.history?.length ?? 0)) acct.history = past;
      }
      if (HOLDINGS.test(c.url)) for (const group of c.body.allAccountHoldings ?? []) {
        const list = group.holdings ?? [], acct = byEnding(list[0]?.accountNumberLastThree);
        if (!acct || list.length <= (acct.holdings?.length ?? 0)) continue;
        acct.holdings = list.filter((h) => typeof h.totalValue === 'number').map((h) => ({ symbol: h.symbol || h.name || 'UNKNOWN', name: h.name, quantity: h.quantity ?? null, price: h.price ?? null, value: h.totalValue,
          costBasis: typeof h.TotalCost === 'number' ? h.TotalCost : typeof h.avgUnitprice === 'number' && typeof h.quantity === 'number' ? Math.round(h.avgUnitprice * h.quantity * 100) / 100 : null, assetType: h.holdingCategory ?? h.assetClass }));
      }
    }
    const out = [...accounts.values()].map(({ txns, ...a }) => {
      const transactions = [...txns.values()];
      return { ...a, transactions, ...(a.type === 'cash' || a.type === 'credit' ? { history: balanceHistory(a.balance, transactions) } : {}) };
    });
    if (!out.length) throw new Error('Citi sent an account list, but no account carried a balance');
    const detail = out.map((a, i) => `account ${i + 1}: ${a.type}, balance ${a.balance ? 'non-zero' : 'zero'}, ${a.transactions.length} transactions, ${a.holdings?.length ?? 0} holdings, ${a.history?.length ?? 0} past values`);
    return { accounts: out, detail, note: `${out.reduce((s, a) => s + a.transactions.length, 0)} transactions, ${out.reduce((s, a) => s + (a.holdings?.length ?? 0), 0)} holdings` };
  },
};
