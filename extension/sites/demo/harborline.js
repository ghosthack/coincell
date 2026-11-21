// Harborline Bank (demo): reads the accounts page, then every page of each account's activity.
globalThis.__coincellSite = async () => {
  const { page, text, parseMoney, mdyToIso, balanceHistory } = globalThis.coincell;
  const loggedOut = /login|verify/;
  const home = await page('/accounts', loggedOut);
  const accounts = [];
  for (const el of home.querySelectorAll('.acct')) {
    const id = el.dataset.acct, balance = parseMoney(text(el.querySelector('.avail strong')));
    const transactions = [];
    for (let query = ''; query != null;) {
      const doc = await page(`/accounts/${id}${query}`, loggedOut);
      for (const tr of doc.querySelectorAll('#activity tbody tr')) {
        const [date, description, withdrawal, deposit] = [...tr.cells].map(text);
        transactions.push({ date: mdyToIso(date), description, amount: deposit ? parseMoney(deposit) : -parseMoney(withdrawal) });
      }
      query = doc.querySelector('a.older')?.getAttribute('href') ?? null;
    }
    accounts.push({ id, name: text(el.querySelector('h3')), type: 'cash', mask: text(el.querySelector('.acct-num')).match(/(\d{4})\s*$/)?.[1], balance, transactions });
  }
  const since = accounts.flatMap((a) => a.transactions.map((t) => t.date)).sort()[0];
  for (const a of accounts) a.history = balanceHistory(a.balance, a.transactions, since);
  return { accounts };
};
