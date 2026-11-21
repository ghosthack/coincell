// Lakeshore Home Loans (demo): reads the loan page. Each payment keeps its full amount plus the
// principal part, which is the only part that reduces what is owed.
globalThis.__coincellSite = async () => {
  const { page, text, parseMoney, mdyToIso, today } = globalThis.coincell;
  const doc = await page('/loan', /signin|challenge/);
  const field = (name) => text(doc.querySelector(`[data-field="${name}"]`));
  const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const number = field('loan-number'), balance = -parseMoney(field('principal-balance'));
  const transactions = [], history = [];
  for (const tr of doc.querySelectorAll('#payments tbody tr')) {
    const [date, ref, total, principal, interest, escrow, after] = [...tr.cells].map(text);
    const p = parseMoney(principal);
    transactions.push({ id: ref, date: mdyToIso(date), amount: parseMoney(total), principal: p, category: 'Loan payment',
      description: `Payment received: ${fmt(p)} principal, ${fmt(parseMoney(interest))} interest, ${fmt(parseMoney(escrow))} escrow` });
    history.push({ date: mdyToIso(date), balance: -parseMoney(after) });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length) { const d = new Date(`${history[0].date}T12:00:00`); d.setDate(d.getDate() - 1); history.unshift({ date: today(d), balance: history[0].balance - transactions.at(-1).principal }); }
  const daily = [];
  for (let i = 0; i < history.length; i++) {
    const stop = history[i + 1]?.date ?? today();
    for (let d = new Date(`${history[i].date}T12:00:00`); today(d) < stop; d.setDate(d.getDate() + 1)) daily.push({ date: today(d), balance: history[i].balance });
  }
  return { accounts: [{ id: number, name: text(doc.querySelector('#loan-summary h2')), type: 'loan', mask: number.slice(-4), balance, transactions, history: daily,
    rate: parseFloat(field('rate')) / 100, dueAmount: parseMoney(field('payment-amount')), dueDate: mdyToIso(field('next-due')) }] };
};
