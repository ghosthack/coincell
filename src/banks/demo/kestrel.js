// Kestrel Card (demo site): a credit card served by a single-page app.
// Technique: listen to the JSON the app itself loads, pressing "Load more" until done.
import { captureJson } from '../../browser.js';
import { balanceHistory } from '../../history.js';
import { totp } from '../../totp.js';

const URL = 'http://localhost:4702';

export default {
  id: 'kestrel', name: 'Kestrel Card', needsBrowser: true,
  async sync({ page, log }) {
    const hits = await captureJson(page, /\/api\/v2\/card\/(summary|activity)/, async () => {
      await page.goto(URL);
      await page.waitForSelector('#login-form, #card-summary');
      if (await page.locator('#login-form').count()) {
        log('Signing in');
        await page.fill('#user-id', 'demo');
        await page.locator('#pass').pressSequentially('kestrel-demo');   // key by key: this site ignores a password set in one go
        await page.click('#login-form button');
        await page.fill('#totp-code', totp(await page.locator('#demo-key').innerText()).code);   // what an authenticator app would show
        await page.click('#code-form button');
        await page.waitForSelector('#card-summary');
      }
      // Wait for each page of activity to land, then ask for the next until the button goes away.
      const idle = () => page.waitForFunction(() => !document.querySelector('#load-more:disabled'));
      for (let i = 0; i < 200; i++) {
        await idle();
        if (!(await page.locator('#load-more').isVisible())) break;
        await page.click('#load-more');
      }
    });
    const summary = hits.find((h) => h.url.includes('/summary') && h.body.card)?.body;
    if (!summary) throw new Error('Card summary was not loaded');
    const seen = new Map(); // the card shows purchases as positive; this app stores them as negative
    for (const h of hits) for (const t of h.body.items ?? []) {
      seen.set(t.id, { id: t.id, date: t.postedAt.slice(0, 10), description: t.merchant, amount: -t.amountCents / 100 });
    }
    const transactions = [...seen.values()];
    const balance = -summary.currentBalanceCents / 100;
    log(`${summary.card.productName}: owes ${(-balance).toFixed(2)}, ${transactions.length} transactions`);
    return { accounts: [{
      id: summary.card.last4, name: summary.card.productName, type: 'credit', mask: summary.card.last4, balance, transactions,
      creditLimit: summary.creditLimitCents / 100,
      dueAmount: summary.remainingStatementBalanceCents / 100, dueDate: summary.paymentDueDate,
      history: balanceHistory(balance, transactions),
    }] };
  },
};
