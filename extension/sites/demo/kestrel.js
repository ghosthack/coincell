// Kestrel Card (demo): asks the site's own data service for the summary and every page of activity.
globalThis.__coincellSite = async () => {
  const { json, balanceHistory } = globalThis.coincell;
  const summary = await json('/api/v2/card/summary');
  const transactions = [];
  for (let cursor = '0'; cursor != null;) {
    const p = await json(`/api/v2/card/activity?cursor=${cursor}`);
    for (const t of p.items) transactions.push({ id: t.id, date: t.postedAt.slice(0, 10), description: t.merchant, amount: -t.amountCents / 100 });   // the card shows purchases as positive
    cursor = p.nextCursor;
  }
  const balance = -summary.currentBalanceCents / 100;
  return { accounts: [{ id: summary.card.last4, name: summary.card.productName, type: 'credit', mask: summary.card.last4, balance, transactions,
    creditLimit: summary.creditLimitCents / 100, dueAmount: summary.remainingStatementBalanceCents / 100, dueDate: summary.paymentDueDate,
    history: balanceHistory(balance, transactions) }] };
};
