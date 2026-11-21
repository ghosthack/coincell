// Chase, by capture. Reloads the dashboard, then opens each account the way you would by
// clicking it, and uses the answers the site's own pages receive. Written from a masked
// recording: field names and settings are known, but no real values were seen.
//
// What comes from where:
//   the dashboard's opening bundle  -> the list of accounts ("tiles") with balances
//   each checking/savings page      -> its transactions
//   each card page                  -> its transactions, limit and statement balance
//   the investment positions feed   -> holdings per investment account
import { balanceHistory } from '../shared.js';

const TILES = /\/dashboard\/tiles\/list/, CARD_DETAIL = /\/account\/detail\/card\/list/;
const DDA_TXNS = /\/etu-dda-transactions\/v4\/transactions/, CARD_TXNS = /\/etu-transactions\/v4\/accounts\/transactions/;
const INVESTMENT_LIST = /\/portfolio\/account\/options\/list2/, POSITIONS = /\/digital-investment-positions\/v4\/positions/;
const ymd = (s) => (/^\d{8}$/.test(String(s ?? '')) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : /^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) ? String(s).slice(0, 10) : null);
const cents = (n) => Math.round(n * 100) / 100;

// Answers the site bundles together arrive as { cache: [{ url, request, response }] }.
function* answers(captured) {
  for (const c of captured) {
    yield c;
    for (const inner of c.body?.cache ?? []) if (inner?.url && inner.response) yield { url: inner.url, body: inner.response, status: 200 };
  }
}

export default {
  loggedOut: /logon|\/login|signin/i,
  steps: [{
    go: '/web/auth/dashboard#/dashboard/overview', reload: true, timeout: 60_000,
    waitFor: [/\/app\/data\/list/],
    // Runs in the page. Opens each account's page in turn and waits for its transactions to load,
    // then repeats that same request for earlier activity. Finishes back on the overview.
    act: async () => {
      const seen = () => window.__coincellCapture ?? [];
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (test, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { const hit = seen().find(test); if (hit) return hit; } return null; };
      const fresh = (h = {}) => ('x-jpmc-client-request-id' in h ? { ...h, 'x-jpmc-client-request-id': crypto.randomUUID() } : { ...h });
      const boot = seen().find((e) => /\/app\/data\/list/.test(e.url));
      const tiles = boot?.body?.cache?.find((c) => /\/dashboard\/tiles\/list/.test(c.url))?.response;
      if (!tiles) return;

      for (const t of tiles.accountTiles ?? []) {
        if (t.unavailable || !t.accountTileType || !t.accountTileDetailType) continue;
        const card = t.accountTileType === 'CARD';
        if (!card && t.accountTileType !== 'DDA') continue;   // other kinds have not been seen yet
        const feed = card ? /\/etu-transactions\/v4\/accounts\/transactions/ : /\/etu-dda-transactions\/v4\/transactions/;
        const since = Date.now();
        location.hash = `#/dashboard/summary/${t.accountId}/${t.accountTileType}/${t.accountTileDetailType}`;
        const own = await waitFor((e) => e.at >= since && e.status < 400 && feed.test(e.url) && new URL(e.url).searchParams.get('digital-account-identifier') === String(t.accountId));
        if (own && !card) {
          // Checking and savings: keep pressing "see more", in effect. Each answer carries a
          // bookmark for the next page; ask again with it until the site says there is no more.
          let last = own.body, pages = 0;
          const ask = new URL(own.url);
          ask.searchParams.set('requested-record-count', '100');
          while (last?.moreRecordsIndicator && last.scrollKeyPageOffsetRecordIdentifier && pages++ < 25) {
            ask.searchParams.set('scroll-key-page-offset-record-identifier', last.scrollKeyPageOffsetRecordIdentifier);
            const res = await fetch(ask, { headers: fresh(own.sent?.headers), credentials: 'include' }).catch(() => null);
            if (!res?.ok) { if (ask.searchParams.get('requested-record-count') === '32') break; ask.searchParams.set('requested-record-count', '32'); continue; }
            last = await res.clone().json().catch(() => null);
            await sleep(500);
          }
        }
        if (own && card) {
          // Cards: the page shows only the current statement. Ask the same question for earlier
          // periods, 60 days at a time, back about two years or until three periods are empty.
          const stamp = (d, dashes) => { const p = (n) => String(n).padStart(2, '0'); return [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())].join(dashes ? '-' : ''); };
          const range = async (from, to, dashes, count) => {
            const ask = new URL(own.url);
            ask.searchParams.set('record-count', count);
            ask.searchParams.set('account-activity-start-date', stamp(from, dashes));
            ask.searchParams.set('account-activity-end-date', stamp(to, dashes));
            ask.searchParams.set('request-type-code', 'T');
            const res = await fetch(ask, { headers: fresh(own.sent?.headers), credentials: 'include' }).catch(() => null);
            return res?.ok ? await res.clone().json().catch(() => null) : null;
          };
          const day = 86_400_000;
          let dashes = false, count = '100', to = new Date(), empty = 0;
          for (let i = 0; i < 12 && empty < 3; i++) {
            const from = new Date(to.getTime() - 59 * day);
            let got = await range(from, to, dashes, count);
            if (!got && i === 0) {   // first try: find the date style and the row count the site accepts
              for (const [d, c] of [[true, '100'], [false, '50'], [true, '50']]) { got = await range(from, to, d, c); if (got) { dashes = d; count = c; break; } }
              if (!got) break;
            }
            if (got?.moreTransactionsIndicator) {   // too many for one answer: take the period in two halves
              const mid = new Date(to.getTime() - 30 * day);
              await range(mid, to, dashes, count); await sleep(400);
              await range(from, new Date(mid.getTime() - day), dashes, count);
            }
            empty = got?.activities?.length ? 0 : empty + 1;
            to = new Date(from.getTime() - day);
            await sleep(500);
          }
        }
        await sleep(900);
      }

      if (tiles.investmentTiles?.length) {
        const headers = boot.sent?.headers ?? {};
        let list = seen().find((e) => /\/portfolio\/account\/options\/list2/.test(e.url))?.body;
        if (!list) {
          const res = await fetch('/svc/rr/accounts/secure/v2/portfolio/account/options/list2', { method: 'POST', headers: fresh(headers), body: 'filterOption=ALL', credentials: 'include' }).catch(() => null);
          list = res?.ok ? await res.clone().json().catch(() => null) : null;
        }
        for (const a of list?.accounts ?? []) {
          if (a.accountCategoryType !== 'INVESTMENT') continue;
          await fetch('/svc/wr/dwm/secure/gateway/investments/servicing/inquiry-maintenance/digital-investment-positions/v4/positions', { method: 'POST', credentials: 'include',
            headers: { ...fresh(headers), 'content-type': 'application/json' },
            body: JSON.stringify({ selectorIdentifier: String(a.accountId), selectorCode: 'ACCOUNT', intradayUpdateIndicator: true, topPositionsRequestedRecordCount: 5, accountStatusIndicator: true, moversRequestedRecordCount: 5 }) }).catch(() => null);
          await sleep(700);
        }
      }
      location.hash = '#/dashboard/overview';
      await sleep(800);
    },
  }],

  build(captured) {
    const all = [...answers(captured)];
    const tiles = all.find((c) => TILES.test(c.url) && c.body?.accountTiles)?.body;
    if (!tiles) throw new Error('Chase did not send the list of accounts');
    const accounts = new Map();
    for (const t of tiles.accountTiles) {
      const d = t.tileDetail ?? {};
      if (t.unavailable || typeof d.currentBalance !== 'number') continue;
      const card = t.accountTileType === 'CARD';
      accounts.set(String(t.accountId), { id: String(t.accountId), name: t.nickname || t.cardType || t.accountTileDetailType, mask: t.mask, type: card ? 'credit' : 'cash',
        balance: card ? -d.currentBalance : d.currentBalance, txns: new Map(),
        ...(card ? { dueAmount: d.nextPaymentAmount ?? null, dueDate: ymd(d.nextPaymentDueDate) } : {}) });
    }
    for (const c of all) {   // fuller card details, when a card's page was opened
      const a = CARD_DETAIL.test(c.url) ? accounts.get(String(c.body?.accountId)) : null, d = c.body?.detail;
      if (!a || !d) continue;
      if (typeof d.currentBalance === 'number') a.balance = -d.currentBalance;
      if (typeof d.creditLimit === 'number') a.creditLimit = d.creditLimit;
      if (typeof d.remainingStmtBalance === 'number') a.dueAmount = d.remainingStmtBalance;   // what clears the statement, not the minimum
      a.dueDate = ymd(d.nextPaymentDueDate) ?? a.dueDate;
    }
    // On Chase's lists amounts carry no sign; D means money out (or a card purchase), C money in.
    const signed = (amount, code) => (code === 'C' ? Math.abs(amount) : -Math.abs(amount));
    for (const c of captured) {
      const a = accounts.get(new URL(c.url).searchParams.get('digital-account-identifier') ?? '');
      if (!a || c.status >= 400) continue;
      if (DDA_TXNS.test(c.url)) for (const t of c.body?.transactions ?? []) {
        const date = ymd(t.transactionPostDate) ?? ymd(t.transactionDate), id = t.transactionIdentifier ?? t.etuTransactionIdentifier;
        if (t.pendingTransactionIndicator || !date || !id || typeof t.transactionAmount !== 'number') continue;   // pending lines change before they post
        a.txns.set(id, { id, date, description: String(t.transactionDescription ?? '').replace(/\s+/g, ' ').trim(), amount: signed(t.transactionAmount, t.creditDebitCode) });
      }
      if (CARD_TXNS.test(c.url)) for (const t of c.body?.activities ?? []) {
        const date = ymd(t.transactionPostDate) ?? ymd(t.transactionDate), id = t.derivedUniqueTransactionIdentifier ?? t.sorTransactionIdentifier ?? t.transactionReferenceNumber;
        if (t.transactionStatusCode !== 'Posted' || !date || !id || typeof t.transactionAmount !== 'number') continue;
        const m = t.merchantDetails ?? {};
        a.txns.set(id, { id, date, amount: signed(t.transactionAmount, t.creditDebitCode),
          description: String(m.rawMerchantDetails?.merchantDbaName ?? m.enrichedMerchants?.[0]?.merchantName ?? t.etuStandardTransactionTypeName ?? 'Card transaction').replace(/\s+/g, ' ').trim() });
      }
    }
    // Investment accounts: named by the investment list, valued and itemised by the positions feed.
    const invested = all.find((c) => INVESTMENT_LIST.test(c.url) && c.body?.accounts)?.body.accounts ?? [];
    let holdings = 0;
    for (const c of captured) {
      if (!POSITIONS.test(c.url) || c.status >= 400 || !c.body?.positionsSummary) continue;
      let asked; try { asked = JSON.parse(c.sent ?? '{}'); } catch { asked = {}; }
      const info = invested.find((a) => String(a.accountId) === String(asked.selectorIdentifier));
      if (!info) continue;   // an answer for a group of accounts, or one that cannot be tied to an account
      const list = [];
      for (const p of c.body.positions ?? []) {
        const value = p.marketValue?.baseValueAmount;
        if (typeof value !== 'number') continue;
        list.push({ symbol: p.securityIdDetail?.symbolSecurityIdentifier || p.instrumentShortName || 'UNKNOWN', name: p.instrumentLongName ?? p.instrumentShortName, quantity: p.tradedUnitQuantity ?? null,
          price: p.marketPrice?.baseValueAmount ?? null, value, costBasis: p.tradedCost?.baseValueAmount ?? null });
      }
      const cash = (c.body.cashSweepPositionSummary?.positions ?? []).reduce((s, p) => s + (p.marketValue?.baseValueAmount ?? 0), 0);
      if (cash) list.push({ symbol: 'CASH', name: 'Cash & sweep', quantity: cash, price: 1, value: cash, costBasis: null });
      holdings += list.length;
      accounts.set(String(info.accountId), { id: String(info.accountId), name: info.nickname || 'Chase investment account', mask: info.mask, type: info.retirement ? 'retirement' : 'investment',
        balance: cents(list.reduce((s, h) => s + h.value, 0)), holdings: list, txns: new Map() });
    }

    const out = [...accounts.values()].map(({ txns, ...a }) => {
      const transactions = [...txns.values()];
      // A checking or card balance can be walked back through its transactions for the chart.
      return { ...a, transactions, ...(a.type === 'cash' || a.type === 'credit' ? { history: balanceHistory(a.balance, transactions) } : {}) };
    });
    if (!out.length) throw new Error('Chase sent an account list, but no account carried a balance');
    const count = out.reduce((s, a) => s + a.transactions.length, 0), without = out.filter((a) => a.type !== 'investment' && a.type !== 'retirement' && !a.transactions.length).length;
    return { accounts: out, note: `${count} transactions, ${holdings} holdings${without ? `, ${without} account${without === 1 ? '' : 's'} with no transactions loaded` : ''}${tiles.investmentTiles?.length && !holdings ? ', investments not read' : ''}` };
  },
};
