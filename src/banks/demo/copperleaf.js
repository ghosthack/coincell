// Copperleaf Card (demo site): a second credit card.
// Technique: read the summary off the page, then use the site's own CSV export for transactions.
import fs from 'node:fs';
import { parseMoney } from '../../browser.js';
import { parseCsv } from '../../csv.js';
import { balanceHistory, mdyToIso } from '../../history.js';

const URL = 'http://localhost:4703';

export default {
  id: 'copperleaf', name: 'Copperleaf Card', needsBrowser: true,
  async sync({ page, log }) {
    await page.goto(`${URL}/overview`);
    if (page.url().includes('/login')) {
      log('Signing on');
      await page.fill('input[name="userId"]', 'demo');
      await page.locator('input[name="passcode"]').pressSequentially('copper-demo');   // key by key: this site wants to see keys pressed
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/(remember|overview)/);
    }
    if (page.url().includes('/remember')) await page.click('#not-now');
    await page.waitForSelector('[data-field="current-balance"]');
    const field = (name) => page.locator(`[data-field="${name}"]`).innerText();
    const title = await page.locator('main h2').first().innerText(); // "Copperleaf Travel Card ending in 7731"
    const [, name, mask] = title.match(/^(.*) ending in (\d{4})$/) ?? [null, title, null];
    const due = await field('due-date');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-csv')]);
    const rows = parseCsv(fs.readFileSync(await download.path(), 'utf8'));
    const transactions = rows.map((r) => ({ id: r.Reference, date: mdyToIso(r['Posted Date']), description: r.Description, amount: -Number(r.Amount) }));
    const balance = -parseMoney(await field('current-balance'));
    log(`${name}: owes ${(-balance).toFixed(2)}, ${transactions.length} transactions from CSV`);
    return { accounts: [{
      id: mask ?? 'card', name, type: 'credit', mask, balance, transactions,
      creditLimit: parseMoney(await field('credit-line')),
      dueAmount: parseMoney(await field('remaining-balance')), dueDate: /\d/.test(due) ? mdyToIso(due) : null,
      history: balanceHistory(balance, transactions),
    }] };
  },
};
