// TEMPLATE for a real bank. Copy this file, fill in the TODOs, and add the copy
// to src/banks/index.js. Use `npm run record -- https://your.bank/login` first:
// it shows which JSON calls the bank's site makes, which tells you what to
// capture below.
import { waitForLogin, captureJson, parseMoney } from '../browser.js';

export default {
  id: 'mybank',
  name: 'My Bank (template - not wired up)',
  needsBrowser: true,

  /** @param {{ page: import('playwright').Page, log: (msg: string) => void }} ctx */
  async sync({ page, log }) {
    // 1. Open the login page. You sign in yourself in the browser window.
    await page.goto('https://www.example-bank.com/login'); // TODO
    log('Waiting for you to log in (and finish 2FA) in the browser window...');
    await waitForLogin(page, { url: /\/accounts|\/dashboard/ }); // TODO: something only true after login

    // 2. Preferred: read the JSON the site itself loads.
    const hits = await captureJson(page, /\/api\/accounts/, async () => { // TODO: pattern from `npm run record`
      await page.reload();
    });
    log(`Captured ${hits.length} account responses`);

    // 3. Map the bank's data to this app's shape. Debts (cards, loans) are negative.
    const accounts = [];
    for (const raw of hits.flatMap((h) => h.body.accounts ?? [])) { // TODO
      accounts.push({
        id: raw.id,                      // stable id; never changes between syncs
        name: raw.displayName,
        type: 'cash',                    // 'cash' | 'investment' | 'credit' | 'loan'
        currency: 'USD',
        mask: String(raw.number ?? '').slice(-4),
        balance: parseMoney(raw.balance),
        // holdings: [{ symbol, name, quantity, price, value, costBasis }],
        // transactions: [{ id, date: 'YYYY-MM-DD', description, amount }],
      });
    }

    // Fallback when there is no usable JSON: read the page itself, e.g.
    //   const rows = await page.locator('table.accounts tr').all();
    //   for (const row of rows) { await row.locator('td').nth(0).innerText(); ... }

    if (!accounts.length) throw new Error('No accounts found - the selectors/patterns in mybank.js need filling in');
    return { accounts };
  },
};
