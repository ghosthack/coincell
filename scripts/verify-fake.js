// Compare what the scrapers stored against what the fake institutions actually hold.
// Run after `npm run fakebanks` + a full sync:  node scripts/verify-fake.js
import { buildWorld } from '../fakebanks/world.js';
import { getAccounts, getTransactions, getNetWorth, getCashflow } from '../src/db.js';

const w = buildWorld().accounts;
const truth = { 'harborline:chk': w.chk, 'harborline:sav': w.sav, 'kestrel:0085': w.kes, 'copperleaf:7731': w.cop,
  'meridian:Z31-553318': w.brk, 'meridian:R18-220764': w.ira, 'meridian:P40-009912': w.k401,
  'lakeshore:0044871236': { ...w.mtg, tx: w.mtg.tx.map((t) => ({ ...t, amount: t.total })) } };
let bad = 0;
const check = (label, got, want) => { const ok = Math.abs(got - want) < 0.005; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got} ${ok ? '' : `(expected ${want})`}`); };

const accounts = getAccounts().filter((a) => a.bank !== 'manual');
check('accounts found', accounts.length, Object.keys(truth).length);
for (const a of accounts) {
  const t = truth[a.id];
  if (!t) { bad++; console.log(`FAIL unexpected account ${a.id}`); continue; }
  const tx = getTransactions({ account: a.id, limit: 2000 });
  check(`${a.name} balance`, a.balance, t.bal ?? t.total);
  check(`${a.name} transactions`, tx.length, t.tx.length);
  check(`${a.name} transaction total`, Math.round(tx.reduce((s, x) => s + x.amount, 0) * 100) / 100, Math.round(t.tx.reduce((s, x) => s + x.amount, 0) * 100) / 100);
  if (t.statement) check(`${a.name} amount due`, a.due_amount, t.statement.remaining);
  if (t.pi) check(`${a.name} principal paid`, Math.round(tx.reduce((s, x) => s + x.principal, 0) * 100) / 100, Math.round(t.tx.reduce((s, x) => s + x.principal, 0) * 100) / 100);
}
const all = getTransactions({ limit: 2000 });
const movers = all.filter((t) => /AUTOPAY|PYMT|PAYMENT RECEIVED|ONLINE PAYMENT|Transfer (to|from)|MERIDIAN WEALTH|funds transfer|IRA contribution/i.test(t.description));
const unlinked = movers.filter((t) => !t.transfer_id);
check('own-account moves left unmatched', unlinked.length, 0);
for (const t of unlinked) console.log('     ', t.date, t.account_name, t.description, t.amount);
const wrong = all.filter((t) => t.transfer_id && !movers.includes(t));
check('ordinary transactions wrongly matched as transfers', wrong.length, 0);
const nw = getNetWorth();
check('net worth today', Math.round(nw.at(-1).value * 100) / 100, Math.round((Object.values(truth).reduce((s, t) => s + (t.bal ?? t.total), 0) + getAccounts().filter((a) => a.bank === 'manual').reduce((s, a) => s + a.balance, 0)) * 100) / 100);
console.log(`net worth history: ${nw.length} days from ${nw[0].date}`);
console.table(getCashflow().map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v]))));
console.log(bad ? `${bad} check(s) failed` : 'All checks passed');
process.exit(bad ? 1 : 0);
