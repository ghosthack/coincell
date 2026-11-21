// Newrez (mortgage), two ways in:
//   - the browser extension (extension/sites/newrez*.js): log in in your own Chrome, press Send
//   - this adapter: `npm run sync -- newrez` opens a browser window, you log in there, and it
//     reads the loan itself. It is a plain automated browser and says so to the site; if Newrez
//     ever refuses it, use the extension.
// Both produce the same account, so they can be used interchangeably.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.js';
import { waitForLogin } from '../browser.js';
import servicing from '../../extension/sites/newrez-servicing.js';   // the same reading of Newrez's data the extension uses

const HOME = 'https://myaccount.newrez.com/dashboard';
const API = /shellpointmortgageservicing\.com\/api\//i;

export default {
  id: 'newrez', name: 'Newrez', needsBrowser: true,
  async sync({ page, context, log }) {
    await page.goto(HOME);
    log('Waiting for you to log in to Newrez in the browser window (up to 10 minutes)...');
    await waitForLogin(page, { selector: 'mad-servicing-loan-card, .loan-card' });

    // "Account Details" opens the servicing site, whose pages ask a separate host for the loan's
    // data. Watch for one of those requests: it carries the sign-in token and the loan's id.
    const asked = [];
    const watch = (r) => { if (API.test(r.url()) && r.headers().authorization) asked.push(r); };
    context.on('request', watch);
    try {
      await page.click('#accountDetails');
      let pattern = null;
      for (const end = Date.now() + 60_000; Date.now() < end && !pattern; await page.waitForTimeout(400)) {
        pattern = asked.map((r) => { try { const b = JSON.parse(r.postData() ?? '{}'); return { r, LoanId: b.LoanId ?? b.loanId }; } catch { return {}; } }).find((x) => x.LoanId);
      }
      if (pattern) {
        const h = pattern.r.headers(), base = new URL(pattern.r.url()).origin;
        const headers = { authorization: h.authorization, 'content-type': 'application/json', accept: h.accept ?? 'application/json', ...(h['x-csp-servicer'] ? { 'x-csp-servicer': h['x-csp-servicer'] } : {}) };
        const captured = [];
        for (const what of ['/api/loan/getdetail', '/api/loan/gethistory']) {
          const res = await context.request.post(base + what, { headers, data: { LoanId: pattern.LoanId } });
          captured.push({ url: base + what, status: res.status(), body: res.ok() ? await res.json() : null });
        }
        const { accounts, note } = servicing.build(captured);
        log(`Loan details and history read: ${note}`);
        return { accounts };
      }
      log('The account details site did not load its data; reading the dashboard card only');
    } finally {
      context.off('request', watch);
    }

    // Fallback: the loan card on the first page (balance, payment, due date), read as the extension reads it.
    await page.goto(HOME);
    await page.waitForSelector('mad-servicing-loan-card, .loan-card');
    for (const file of ['lib.js', 'sites/newrez.js']) await page.evaluate(fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8'));
    return page.evaluate(() => globalThis.__coincellSite());
  },
};
