// Meridian Wealth (demo site): brokerage, Roth IRA and 401(k).
// Technique: log in through the pages, then call the site's JSON API directly with the logged-in session.
const URL = 'http://localhost:4704';
const TYPES = { BROKERAGE: 'investment', ROTH_IRA: 'retirement', '401K': 'retirement' };

export default {
  id: 'meridian', name: 'Meridian Wealth', needsBrowser: true,
  async sync({ page, context, log }) {
    await page.goto(`${URL}/portfolio`);
    if (page.url().includes('/login')) {
      log('Logging in (username, then password)');
      await page.locator('#username').pressSequentially('demo');   // key by key: this box ignores a value set in one go
      await page.click('#next');
      await page.fill('#password', 'meridian-demo');
      await page.click('#log-in');
      await page.fill('#code', await page.locator('#demo-code').innerText());   // the texted code, which the demo site shows on the page
      await page.click('#verify');
    }
    await page.waitForSelector('#portfolio');
    const get = async (path) => {
      const res = await context.request.get(URL + path);
      if (!res.ok()) throw new Error(`${path} returned ${res.status()}`);
      return res.json();
    };
    const accounts = [];
    for (const a of await get('/api/accounts')) {
      const [positions, history, activity] = await Promise.all([
        get(`/api/accounts/${a.id}/positions`), get(`/api/accounts/${a.id}/history?days=400`), get(`/api/accounts/${a.id}/activity`)]);
      log(`${a.name}: ${a.totalValue}, ${positions.length} positions`);
      accounts.push({
        id: a.number, name: a.name, type: TYPES[a.kind] ?? 'investment', mask: a.number.slice(-4), balance: a.totalValue,
        holdings: positions.map((p) => ({ symbol: p.ticker, name: p.description, quantity: p.shares, price: p.lastPrice, value: p.marketValue, costBasis: p.costBasis })),
        transactions: activity.map((t) => ({ id: t.id, date: t.date, description: t.description, amount: t.amount, category: t.type })),
        history: history.map((h) => ({ date: h.date, balance: h.value })),
      });
    }
    return { accounts };
  },
};
