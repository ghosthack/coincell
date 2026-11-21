// Harborline Bank (demo site): everyday checking + savings.
// Technique: plain page scraping, following the "Older" link through each account's pages.
// The demo credentials are public, so they are typed automatically. A real
// adapter would instead call waitForLogin() and let you sign in by hand.
import { parseMoney } from '../browser.js';
import { balanceHistory, mdyToIso } from '../history.js';

const URL = 'http://localhost:4701';

export default {
  id: 'harborline', name: 'Harborline Bank', needsBrowser: true,
  async sync({ page, log }) {
    await page.goto(`${URL}/accounts`);
    if (page.url().includes('/login')) {
      log('Signing in');
      await page.fill('#username', 'demo');
      await page.fill('#password', 'harbor-demo');
      await page.click('#sign-in');
      await page.waitForURL(/\/(verify|accounts)/);
    }
    if (page.url().includes('/verify')) {
      log('Entering texted security code');
      await page.fill('#code', await page.locator('#demo-code').innerText());
      await page.click('#verify');
    }
    await page.waitForSelector('.acct');
    const found = await page.locator('.acct').evaluateAll((els) => els.map((e) => ({
      id: e.dataset.acct, name: e.querySelector('h3').innerText,
      mask: e.querySelector('.acct-num').innerText.match(/(\d{4})\s*$/)?.[1],
      balance: e.querySelector('.avail strong').innerText,
    })));

    const accounts = [];
    for (const a of found) {
      await page.goto(`${URL}/accounts/${a.id}`);
      const transactions = [];
      for (;;) {
        const rows = await page.locator('#activity tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.innerText.trim())));
        for (const [date, description, withdrawal, deposit] of rows) {
          transactions.push({ date: mdyToIso(date), description, amount: deposit ? parseMoney(deposit) : -parseMoney(withdrawal) });
        }
        const older = page.locator('a.older');
        if (!(await older.count())) break;
        await Promise.all([page.waitForURL(/page=/), older.click()]);
      }
      const balance = parseMoney(a.balance);
      log(`${a.name}: ${a.balance}, ${transactions.length} transactions`);
      accounts.push({ id: a.id, name: a.name, type: 'cash', mask: a.mask, balance, transactions });
    }
    // Every account's list goes back to the same start, so a quiet account's balance is known that far back too.
    const since = accounts.flatMap((a) => a.transactions.map((t) => t.date)).sort()[0];
    for (const a of accounts) a.history = balanceHistory(a.balance, a.transactions, since);
    return { accounts };
  },
};
