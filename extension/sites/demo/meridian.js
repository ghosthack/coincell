// Meridian Wealth (demo): asks the site's data service for accounts, positions, history and activity.
globalThis.__coincellSite = async () => {
  const { json } = globalThis.coincell;
  const TYPES = { BROKERAGE: 'investment', ROTH_IRA: 'retirement', '401K': 'retirement' };
  const accounts = [];
  for (const a of await json('/api/accounts')) {
    const [positions, history, activity] = await Promise.all([json(`/api/accounts/${a.id}/positions`), json(`/api/accounts/${a.id}/history?days=400`), json(`/api/accounts/${a.id}/activity`)]);
    accounts.push({ id: a.number, name: a.name, type: TYPES[a.kind] ?? 'investment', mask: a.number.slice(-4), balance: a.totalValue,
      holdings: positions.map((p) => ({ symbol: p.ticker, name: p.description, quantity: p.shares, price: p.lastPrice, value: p.marketValue, costBasis: p.costBasis })),
      transactions: activity.map((t) => ({ id: t.id, date: t.date, description: t.description, amount: t.amount, category: t.type })),
      history: history.map((h) => ({ date: h.date, balance: h.value })) });
  }
  return { accounts };
};
