// Ally Bank, by capture on the live page. Ally signs you out if its page is reloaded, so nothing
// is reloaded here: the capture starts on the page as it stands, each account is opened by
// clicking its own link on the dashboard, and the answers the site's pages receive are used.
// Older transactions are fetched by repeating the page's own request with the "next page"
// details each answer carries. Written from a masked recording; no real values were seen.
// Covers deposit accounts (savings, checking, CDs). Ally Invest accounts are not read yet.
import { balanceHistory } from '../shared.js';

const DETAIL = /\/acs\/v1\/bank-accounts\/[^/?]+(\?|$)/, SEARCH = /\/acs\/v1\/bank-accounts\/transactions\/search/;
const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) ? String(s).slice(0, 10) : null);

export default {
  loggedOut: /\/login|\/signin|logged-out|session-expired/i,
  steps: [{
    live: true,
    // Runs in the page.
    act: async () => {
      const seen = () => window.__coincellCapture ?? [];
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (test, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { const hit = test(); if (hit) return hit; } return null; };
      const links = () => [...new Set([...document.querySelectorAll('a[href*="/account/"]')].map((a) => a.getAttribute('href').match(/\/account\/([^/?#]+)\/details/)?.[1]).filter(Boolean))];
      const home = location.pathname;
      const ids = await until(() => (links().length ? links() : null), 6000);
      if (!ids) return { error: 'No accounts are showing. Open your Ally dashboard (the page listing your accounts), then press the button again.' };

      for (const id of ids) {
        const link = await until(() => document.querySelector(`a[href*="/account/${id}/details"]`), 8000);
        if (!link) continue;
        const since = Date.now();
        link.click();
        // The account's own page asks for its details and its first page of transactions.
        const own = await until(() => seen().find((e) => e.at >= since && e.status < 400 && /\/bank-accounts\/transactions\/search/.test(e.url) && e.sent?.body?.includes(id)), 15_000);
        let next = own?.body?.searchResults?.flatMap((r) => r.transactionHistory ?? []).find((h) => h.nextPageRequestDetails)?.nextPageRequestDetails;
        for (let page = 0; own && next && page < 80; page++) {   // "show more", until the site has no more
          const res = await fetch(own.url, { method: 'POST', headers: own.sent.headers, body: JSON.stringify(next), credentials: 'include' }).catch(() => null);
          const got = res?.ok ? await res.clone().json().catch(() => null) : null;
          const history = got?.searchResults?.flatMap((r) => r.transactionHistory ?? []) ?? [];
          if (!history.some((h) => h.transactions?.length)) break;
          next = history.find((h) => h.nextPageRequestDetails)?.nextPageRequestDetails;
          await sleep(400);
        }
        await sleep(500);
        history.back();   // back to the list of accounts, as the Back button would
        await until(() => location.pathname === home && links().length, 10_000);
        await sleep(400);
      }
      return { opened: ids.length };
    },
  }],

  build(captured) {
    const accounts = new Map();   // by account number, which is what the transaction lists carry
    for (const c of captured) {
      if (!DETAIL.test(c.url) || SEARCH.test(c.url) || c.status >= 400) continue;
      const d = Object.values(c.body ?? {}).find((v) => v && typeof v === 'object' && typeof v.currentBalancePvtEncrypt === 'number');
      const number = String(d?.accountNumberPvtEncrypt ?? '');
      if (!d || !number) continue;
      accounts.set(number, { id: `${d.accountType ?? 'ACCT'}-${number.slice(-6)}`, name: d.accountNickname || d.productDescription || 'Ally account', mask: number.slice(-4),
        type: d.retirementAccountIndicator ? 'retirement' : 'cash', balance: d.currentBalancePvtEncrypt, txns: new Map() });
    }
    if (!accounts.size) throw new Error('Ally did not send any account details. Open your Ally dashboard, then press the button again.');
    for (const c of captured) {
      if (!SEARCH.test(c.url) || c.status >= 400) continue;
      for (const r of c.body?.searchResults ?? []) {
        const a = accounts.get(String(r.accountNumber ?? ''));
        if (!a) continue;
        for (const h of r.transactionHistory ?? []) for (const t of h.transactions ?? []) {
          const date = day(t.transactionPostingDate), amount = t.transactionAmountPvtEncrypt, id = t.transactionId ?? t.transactionIndex ?? `${date}-${t.transactionSequenceNumber}`;
          if (!/^posted$/i.test(t.transactionStatus ?? '') || !date || typeof amount !== 'number' || amount === 0) continue;   // pending lines change before they post
          // The site's id only tells lines apart within this visit: it is a new token every time you log in,
          // so it is not passed on. coincell then names each line by its date, amount and description.
          a.txns.set(String(id), { date, description: String(t.transactionDescription ?? t.transactionCodeDescription ?? 'Transaction').replace(/\s+/g, ' ').trim(),
            amount: /^credit$/i.test(t.entryType ?? '') ? Math.abs(amount) : -Math.abs(amount) });
        }
      }
    }
    const out = [...accounts.values()].map(({ txns, ...a }) => { const transactions = [...txns.values()]; return { ...a, transactions, history: balanceHistory(a.balance, transactions) }; });
    return { accounts: out, note: `${out.reduce((s, a) => s + a.transactions.length, 0)} transactions` };
  },
};
