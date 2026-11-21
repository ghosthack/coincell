// Lakeshore Home Loans (demo site): a mortgage.
// A mortgage differs from a card: the payment leaving checking is larger than
// the drop in what you owe, because part of it is interest and escrow. Each
// payment is stored with its full amount (so it pairs with the checking debit)
// plus the `principal` part, which is the only part that reduces the debt.
import { parseMoney } from '../browser.js';
import { mdyToIso } from '../history.js';
import { today } from '../paths.js';

const URL = 'http://localhost:4705';

export default {
  id: 'lakeshore', name: 'Lakeshore Home Loans', needsBrowser: true,
  async sync({ page, log }) {
    await page.goto(`${URL}/loan`);
    if (page.url().includes('/signin')) {
      log('Signing in');
      await page.fill('#user', 'demo');
      await page.fill('#pw', 'lakeshore-demo');
      await page.click('#signin');
      await page.waitForURL(/\/(challenge|loan)/);
    }
    if (page.url().includes('/challenge')) {
      log(`Answering security question: ${await page.locator('#question').innerText()}`);
      await page.fill('#answer', await page.locator('#demo-answer').innerText());
      await page.click('#continue');
    }
    await page.waitForSelector('#loan-summary');
    const field = (name) => page.locator(`[data-field="${name}"]`).innerText();
    const number = await field('loan-number');
    const balance = -parseMoney(await field('principal-balance'));
    const rows = await page.locator('#payments tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.innerText.trim())));
    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const transactions = [], history = [];
    for (const [date, ref, total, principal, interest, escrow, after] of rows) {
      const p = parseMoney(principal);
      transactions.push({ id: ref, date: mdyToIso(date), amount: parseMoney(total), principal: p, category: 'Loan payment',
        description: `Payment received: ${fmt(p)} principal, ${fmt(parseMoney(interest))} interest, ${fmt(parseMoney(escrow))} escrow` });
      history.push({ date: mdyToIso(date), balance: -parseMoney(after) });
    }
    // The balance only changes on payment days; fill the days in between so the chart has no gaps.
    const daily = [];
    history.sort((a, b) => a.date.localeCompare(b.date));
    if (history.length) { // the day before the oldest listed payment, the balance was that payment's principal higher
      const d = new Date(`${history[0].date}T12:00:00`); d.setDate(d.getDate() - 1);
      history.unshift({ date: today(d), balance: history[0].balance - transactions.at(-1).principal });
    }
    for (let i = 0; i < history.length; i++) {
      const stop = history[i + 1]?.date ?? today();
      for (let d = new Date(`${history[i].date}T12:00:00`); today(d) < stop; d.setDate(d.getDate() + 1)) daily.push({ date: today(d), balance: history[i].balance });
    }
    log(`Mortgage: owes ${(-balance).toFixed(2)}, ${transactions.length} payments`);
    return { accounts: [{
      id: number, name: await page.locator('#loan-summary h2').innerText(), type: 'loan', mask: number.slice(-4), balance, transactions, history: daily,
      rate: parseFloat(await field('rate')) / 100, // "6.250%" -> 0.0625
      dueAmount: parseMoney(await field('payment-amount')), dueDate: mdyToIso(await field('next-due')),
    }] };
  },
};
