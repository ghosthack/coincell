// Copperleaf Card (demo): reads the overview page and the site's CSV export, without saving a file.
globalThis.__coincellSite = async () => {
  const { page, download, text, parseMoney, parseCsv, mdyToIso, balanceHistory } = globalThis.coincell;
  const doc = await page('/overview', /login|remember/);
  const field = (name) => text(doc.querySelector(`[data-field="${name}"]`));
  const title = text(doc.querySelector('main h2'));
  const [, name, mask] = title.match(/^(.*) ending in (\d{4})$/) ?? [null, title, null];
  const transactions = parseCsv(await download('/activity.csv')).filter((r) => r.Reference)
    .map((r) => ({ id: r.Reference, date: mdyToIso(r['Posted Date']), description: r.Description, amount: -Number(r.Amount) }));
  const balance = -parseMoney(field('current-balance')), due = field('due-date');
  return { accounts: [{ id: mask ?? 'card', name, type: 'credit', mask, balance, transactions,
    creditLimit: parseMoney(field('credit-line')), dueAmount: parseMoney(field('remaining-balance')), dueDate: /\d/.test(due) ? mdyToIso(due) : null,
    history: balanceHistory(balance, transactions) }] };
};
