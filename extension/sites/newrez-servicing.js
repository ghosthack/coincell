// Newrez's servicing site (the "Account Details" side), by capture. The page's data comes from a
// separate host and needs the sign-in token the page itself sends, so the page is reloaded, one
// of its own requests is taken as the pattern, and the loan's details and full payment history
// are asked for the same way. Written from a masked recording; no real values were seen.
// Each payment keeps its full amount plus the principal part, the only part that reduces the debt.
import { today } from '../shared.js';

const API = /shellpointmortgageservicing\.com\/api\//i;
const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) ? String(s).slice(0, 10) : null);
const usd = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default {
  // Not "signin": a reload passes through /servicing/signin-callback on its way back in.
  loggedOut: /\/login\b|logged-out|session-expired/i,
  steps: [{
    here: true, timeout: 60_000,
    waitFor: [API],
    act: async () => {   // runs in the page
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const seen = () => window.__coincellCapture ?? [];
      const loanIn = (e) => { try { const b = JSON.parse(e.sent?.body ?? '{}'); return b.LoanId ?? b.loanId; } catch { return null; } };
      let pattern = null;
      for (const end = Date.now() + 15_000; Date.now() < end && !pattern; await sleep(300)) {
        pattern = seen().find((e) => /shellpointmortgageservicing\.com\/api\//i.test(e.url) && e.status < 400 && e.sent?.headers?.authorization && loanIn(e));
      }
      if (!pattern) return { error: 'Newrez did not load the loan. Open your loan\'s Account Details page, then press the button again.' };
      const base = new URL(pattern.url).origin, LoanId = loanIn(pattern);
      for (const path of ['/api/loan/getdetail', '/api/loan/gethistory']) {
        await fetch(base + path, { method: 'POST', headers: pattern.sent.headers, body: JSON.stringify({ LoanId }) }).catch(() => null);
        await sleep(400);
      }
    },
  }],

  build(captured) {
    const detail = captured.filter((c) => /\/api\/loan\/getdetail/i.test(c.url) && typeof c.body?.PrincipalBalance === 'number').at(-1)?.body;
    if (!detail) throw new Error('Newrez did not send the loan details');
    const rows = captured.filter((c) => /\/api\/loan\/gethistory/i.test(c.url) && Array.isArray(c.body)).at(-1)?.body ?? [];
    const number = String(detail.LoanId ?? ''), rate = typeof detail.InterestRate === 'number' ? (detail.InterestRate > 1 ? detail.InterestRate / 100 : detail.InterestRate) : null;
    const transactions = [], after = new Map();
    for (const r of rows) {
      const date = day(r.TransactionDate);
      if (!date) continue;
      if (typeof r.PrincipalBalance === 'number') { const have = after.get(date); if (have == null || r.PrincipalBalance < have) after.set(date, r.PrincipalBalance); }
      // Payments in. Money the servicer pays out of escrow (taxes, insurance) is not a payment on the loan.
      if (!(r.TransactionAmount > 0)) continue;
      const principal = Math.abs(r.PrincipalAmount ?? 0), interest = Math.abs(r.InterestAmount ?? 0), escrow = Math.abs(r.EscrowAmount ?? 0);
      transactions.push({ id: String(r.HistoryCounter ?? `${date}-${r.TransactionAmount}`), date, amount: r.TransactionAmount, principal, category: 'Loan payment',
        description: `${String(r.Description ?? 'Payment').replace(/\s+/g, ' ').trim()}: ${usd(principal)} principal, ${usd(interest)} interest, ${usd(escrow)} escrow` });
    }
    // The balance only changes on payment days; fill the days between so the chart has no gaps.
    const points = [...after].map(([date, balance]) => ({ date, balance: -balance })).sort((a, b) => a.date.localeCompare(b.date)), history = [];
    for (let i = 0; i < points.length; i++) {
      const stop = points[i + 1]?.date ?? today();
      for (let d = new Date(`${points[i].date}T12:00:00`); today(d) < stop; d.setDate(d.getDate() + 1)) history.push({ date: today(d), balance: points[i].balance });
    }
    return { accounts: [{ id: number.slice(-8), name: 'Mortgage', type: 'loan', mask: number.slice(-4), balance: -detail.PrincipalBalance, rate,
      dueAmount: detail.TotalPayment ?? detail.MonthlyPayment ?? null, dueDate: day(detail.PaymentDueDate), transactions, history }],
      note: `${transactions.length} payments, ${rate ? 'rate read' : 'no rate'}` };
  },
};
