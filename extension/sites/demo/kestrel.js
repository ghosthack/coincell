// Kestrel Card (demo), by capture: reload the site's page, press its "Load more" button until
// everything is showing, and use the answers the page itself received.
import { balanceHistory } from '../../shared.js';

export default {
  loggedOut: /\/login/,
  steps: [{
    go: '/',
    waitFor: [/\/api\/v2\/card\/summary/, /\/api\/v2\/card\/activity/],
    act: async () => {   // runs in the page
      for (let i = 0; i < 400; i++) {
        const more = document.querySelector('#load-more');
        if (!more) break;
        if (!more.disabled) more.click();
        await new Promise((r) => setTimeout(r, 120));
      }
    },
  }],
  build(captured) {
    const summary = captured.find((c) => /\/card\/summary/.test(c.url) && c.body.card)?.body;
    if (!summary) throw new Error('The card summary did not load');
    const seen = new Map();   // the card shows purchases as positive; coincell stores them as negative
    for (const c of captured) for (const t of c.body.items ?? []) seen.set(t.id, { id: t.id, date: t.postedAt.slice(0, 10), description: t.merchant, amount: -t.amountCents / 100 });
    const transactions = [...seen.values()], balance = -summary.currentBalanceCents / 100;
    return { accounts: [{ id: summary.card.last4, name: summary.card.productName, type: 'credit', mask: summary.card.last4, balance, transactions,
      creditLimit: summary.creditLimitCents / 100, dueAmount: summary.remainingStatementBalanceCents / 100, dueDate: summary.paymentDueDate,
      history: balanceHistory(balance, transactions) }] };
  },
};
