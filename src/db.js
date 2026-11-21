import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dataPath, today } from './paths.js';

const db = new DatabaseSync(dataPath('coincell.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, bank TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', mask TEXT,
    due_amount REAL, due_date TEXT, credit_limit REAL, rate REAL
  );
  CREATE TABLE IF NOT EXISTS balances (
    account_id TEXT NOT NULL, date TEXT NOT NULL, balance REAL NOT NULL,
    PRIMARY KEY (account_id, date)
  );
  CREATE TABLE IF NOT EXISTS holdings (
    account_id TEXT NOT NULL, date TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT,
    quantity REAL, price REAL, value REAL NOT NULL, cost_basis REAL,
    PRIMARY KEY (account_id, date, symbol)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT NOT NULL,
    description TEXT NOT NULL, amount REAL NOT NULL, category TEXT,
    transfer_id TEXT, principal REAL
  );
  CREATE INDEX IF NOT EXISTS transactions_date ON transactions (date DESC);
`);

try { db.exec('ALTER TABLE transactions ADD COLUMN principal REAL'); } catch { /* already there */ }

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Store one snapshot from a bank adapter. Shape:
 * { date?: 'YYYY-MM-DD', accounts: [{ id, name, balance, currency?, mask?,
 *     type: 'cash' | 'investment' | 'retirement' | 'property' | 'credit' | 'loan',
 *     dueAmount?, dueDate?,                  // cards and loans: what is owed by when
 *     creditLimit?, rate?,                   // card limit; loan interest rate as a fraction (0.0625)
 *     holdings?: [{ symbol, name?, quantity?, price?, value, costBasis? }],
 *     transactions?: [{ id?, date, description, amount, category?,
 *                      principal? }],        // loan payments: the part that reduces the debt
 *     history?: [{ date, balance }] }] }     // past balances, used only to fill gaps
 * `balance` is the account's contribution to net worth: debts are negative.
 * Transaction amounts follow the same rule: money leaving or a card purchase is negative.
 */
export function saveSnapshot(bankId, snap) {
  const date = snap.date ?? today();
  const upAccount = db.prepare(`INSERT INTO accounts (id, bank, name, type, currency, mask, due_amount, due_date, credit_limit, rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, type = excluded.type, currency = excluded.currency, mask = excluded.mask,
    due_amount = excluded.due_amount, due_date = excluded.due_date, credit_limit = excluded.credit_limit, rate = excluded.rate`);
  const fillBalance = db.prepare('INSERT OR IGNORE INTO balances (account_id, date, balance) VALUES (?, ?, ?)');
  const upBalance = db.prepare(`INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?)
    ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance`);
  const delHoldings = db.prepare('DELETE FROM holdings WHERE account_id = ? AND date = ?');
  const insHolding = db.prepare(`INSERT OR REPLACE INTO holdings
    (account_id, date, symbol, name, quantity, price, value, cost_basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const upTxn = db.prepare(`INSERT INTO transactions (id, account_id, date, description, amount, category, principal)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, description = excluded.description,
    amount = excluded.amount, category = excluded.category, principal = excluded.principal`);

  db.exec('BEGIN');
  try {
    for (const a of snap.accounts ?? []) {
      if (a.id == null || num(a.balance) == null) throw new Error(`Account needs id and numeric balance: ${JSON.stringify(a.name ?? a.id)}`);
      const id = `${bankId}:${a.id}`;
      upAccount.run(id, bankId, String(a.name ?? a.id), a.type ?? 'cash', a.currency ?? 'USD', a.mask ?? null, num(a.dueAmount), a.dueDate ?? null, num(a.creditLimit), num(a.rate));
      upBalance.run(id, date, num(a.balance));
      for (const h of a.history ?? []) if (h.date < date && num(h.balance) != null) fillBalance.run(id, h.date, num(h.balance));
      if (a.holdings) {
        delHoldings.run(id, date);
        for (const h of a.holdings) {
          insHolding.run(id, date, String(h.symbol), h.name ?? null, num(h.quantity), num(h.price), num(h.value) ?? 0, num(h.costBasis));
        }
      }
      const seen = new Map();
      for (const t of a.transactions ?? []) {
        let tid = t.id;
        if (tid == null) {
          // No bank-provided id: hash the content, numbering identical rows so they don't collapse.
          const key = `${t.date}|${t.amount}|${t.description}`;
          const n = (seen.get(key) ?? 0) + 1;
          seen.set(key, n);
          tid = createHash('sha256').update(`${key}|${n}`).digest('hex').slice(0, 24);
        }
        upTxn.run(`${id}:${tid}`, id, t.date, String(t.description ?? ''), num(t.amount) ?? 0, t.category ?? null, num(t.principal));
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getAccounts() {
  return db.prepare(`SELECT a.*, b.balance, b.date AS as_of FROM accounts a
    JOIN balances b ON b.account_id = a.id
      AND b.date = (SELECT MAX(date) FROM balances WHERE account_id = a.id)
    ORDER BY CASE a.type WHEN 'cash' THEN 1 WHEN 'credit' THEN 2 WHEN 'investment' THEN 3 WHEN 'retirement' THEN 4 WHEN 'property' THEN 5 ELSE 6 END, a.bank, a.name`).all();
}

/** Net worth per snapshot date, carrying each account's last known balance forward. */
export function getNetWorth() {
  return db.prepare(`SELECT d.date, (
      SELECT SUM(b.balance) FROM accounts a JOIN balances b ON b.account_id = a.id
        AND b.date = (SELECT MAX(date) FROM balances WHERE account_id = a.id AND date <= d.date)
    ) AS value
    FROM (SELECT DISTINCT date FROM balances) d ORDER BY d.date`).all();
}

/** Net worth per day split into cash / investments / retirement / property / debt (debt is negative). */
export function getNetWorthByType() {
  const group = { cash: 'cash', investment: 'investments', retirement: 'retirement', property: 'property', credit: 'debt', loan: 'debt' };
  const types = new Map(db.prepare('SELECT id, type FROM accounts').all().map((a) => [a.id, group[a.type] ?? 'cash']));
  const rows = db.prepare('SELECT account_id, date, balance FROM balances ORDER BY date').all();
  const current = new Map(), out = [];
  for (let i = 0; i < rows.length;) {
    const date = rows[i].date;
    for (; i < rows.length && rows[i].date === date; i++) current.set(rows[i].account_id, rows[i].balance);
    const p = { date, cash: 0, investments: 0, retirement: 0, property: 0, debt: 0 };
    for (const [id, bal] of current) p[types.get(id) ?? 'cash'] += bal;
    out.push(p);
  }
  return out;
}

export function getHoldings() {
  return db.prepare(`SELECT h.*, a.name AS account_name FROM holdings h
    JOIN accounts a ON a.id = h.account_id
    WHERE h.date = (SELECT MAX(date) FROM holdings WHERE account_id = h.account_id)
    ORDER BY h.value DESC`).all();
}

export function getTransactions({ account, limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  const sql = `SELECT t.*, a.name AS account_name, a.type AS account_type,
      oa.name AS other_account, oa.type AS other_type
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    LEFT JOIN transactions o ON o.id = t.transfer_id LEFT JOIN accounts oa ON oa.id = o.account_id
    ${account ? 'WHERE t.account_id = ?' : ''}
    ORDER BY t.date DESC, t.id LIMIT ?`;
  return account ? db.prepare(sql).all(account, lim) : db.prepare(sql).all(lim);
}

/** Every transaction with its account and, for a matched transfer, the account on the other side. */
export function allTransactions() {
  return db.prepare(`SELECT t.*, a.name AS account_name, a.type AS account_type, a.bank, a.mask,
      oa.name AS other_account, oa.type AS other_type, o.principal AS other_principal
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    LEFT JOIN transactions o ON o.id = t.transfer_id LEFT JOIN accounts oa ON oa.id = o.account_id
    ORDER BY t.date, t.id`).all();
}

const TRADES = new Set(['Buy', 'Sell', 'Dividend', 'Interest', 'Fee', 'Tax']); // activity inside an account, never one side of a transfer

/**
 * Pair up the two sides of money moving between your own accounts: a card
 * payment leaving checking and arriving on the card, a transfer to savings, a
 * deposit to the broker. A pair is the same amount to the cent, in different
 * accounts, with the arrival from 1 day before to 4 days after the departure.
 * When several payments of the same amount could claim one arrival (rent and a
 * mortgage payment of equal size on the same day), the one whose description
 * names the other institution or account number wins.
 * Linked pairs are not counted as income or spending.
 */
export function linkTransfers() {
  const rows = db.prepare(`SELECT t.id, t.account_id, t.date, t.amount, t.category, t.description, a.bank, a.mask
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.transfer_id IS NULL ORDER BY t.date, t.id`).all().filter((r) => !TRADES.has(r.category));
  const arrivals = new Map();
  for (const r of rows) if (r.amount > 0) {
    const k = Math.round(r.amount * 100);
    arrivals.set(k, [...(arrivals.get(k) ?? []), r]);
  }
  const mentions = (t, other) => { const d = t.description.toLowerCase(); return d.includes(other.bank.toLowerCase()) || (other.mask && d.includes(other.mask)); };
  const link = db.prepare('UPDATE transactions SET transfer_id = ? WHERE id = ?');
  const used = new Set();
  let linked = 0;
  // Pass 1 links only pairs where one side names the other; pass 2 links whatever still fits.
  for (const needHint of [true, false]) {
    for (const out of rows) {
      if (out.amount >= 0 || used.has(out.id)) continue;
      let best = null;
      for (const inn of arrivals.get(Math.round(-out.amount * 100)) ?? []) {
        if (used.has(inn.id) || inn.account_id === out.account_id) continue;
        const gap = Math.round((Date.parse(inn.date) - Date.parse(out.date)) / 86_400_000);
        if (gap < -1 || gap > 4) continue;
        if (needHint && !mentions(out, inn) && !mentions(inn, out)) continue;
        if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { inn, gap };
      }
      if (!best) continue;
      used.add(best.inn.id); used.add(out.id);
      link.run(best.inn.id, out.id);
      link.run(out.id, best.inn.id);
      linked++;
    }
  }
  return linked;
}

/** Month-by-month money in and out of bank and card accounts, with own-account moves separated out. */
export function getCashflow() {
  const rows = db.prepare(`SELECT substr(t.date, 1, 7) AS month, t.amount, t.transfer_id, a.type, oa.type AS other_type, o.principal AS other_principal
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    LEFT JOIN transactions o ON o.id = t.transfer_id LEFT JOIN accounts oa ON oa.id = o.account_id
    WHERE a.type IN ('cash', 'credit')`).all();
  const months = new Map();
  for (const r of rows) {
    const m = months.get(r.month) ?? { month: r.month, income: 0, spending: 0, cardPayments: 0, invested: 0, loanPrincipal: 0 };
    months.set(r.month, m);
    if (!r.transfer_id) { if (r.amount > 0) m.income += r.amount; else m.spending -= r.amount; }
    else if (r.amount < 0 && r.other_type === 'credit') m.cardPayments -= r.amount;
    else if (r.amount < 0 && r.other_type === 'loan') {
      // Only the principal pays down debt; interest and escrow are a real cost.
      const principal = Math.min(r.other_principal ?? -r.amount, -r.amount);
      m.loanPrincipal += principal;
      m.spending += -r.amount - principal;
    }
    else if (r.amount < 0 && (r.other_type === 'investment' || r.other_type === 'retirement')) m.invested -= r.amount;
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}
