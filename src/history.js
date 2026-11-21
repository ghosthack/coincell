import { today } from './paths.js';

/**
 * Banks show today's balance plus a transaction list. Walking the transactions
 * backwards from today's balance rebuilds the end-of-day balance for every past
 * day they cover, so the net worth chart has history from the first sync.
 * `since` extends the line further back for an account with no earlier activity
 * (a savings account that sat untouched), when the site's list is known to reach that far.
 */
export function balanceHistory(balance, transactions, since) {
  if (!transactions.length && !since) return [];
  const byDay = new Map();
  for (const t of transactions) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  const first = [...byDay.keys(), ...(since ? [since] : [])].sort()[0];
  const out = [];
  let bal = balance;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const date = today(d);
    if (date < first) break;
    out.push({ date, balance: Math.round(bal * 100) / 100 });
    bal -= byDay.get(date) ?? 0;
  }
  return out.reverse();
}

/** "11/20/2026" -> "2026-11-20" */
export const mdyToIso = (s) => { const [m, d, y] = s.trim().split('/'); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; };
