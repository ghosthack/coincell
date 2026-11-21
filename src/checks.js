// After each import, compare what just arrived with what was on record for that institution.
// Sites change, and a script that half-works is worse than one that fails: it looks fine while
// quietly bringing less. These checks turn "less than last time" into a warning you see.
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const some = (names) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '));

/**
 * @param before  accounts on record before this import: [{ id, name, type, balance, holdings,
 *                transactions (over the period this import covers), recent (last 60 days) }]
 * @param snapshot what just arrived: { accounts: [{ id, name, balance, holdings?, transactions? }] }
 * @returns plain-language warnings, empty when nothing looks off
 */
export function compareWithLastTime(before, snapshot) {
  const warnings = [];
  if (!before.length) return warnings;   // first import: nothing to compare with
  const arrived = new Map(snapshot.accounts.map((a) => [String(a.id), a]));

  const missing = before.filter((b) => !arrived.has(b.id) && (b.balance || b.recent || b.holdings));
  if (missing.length) warnings.push(`${missing.length} account${missing.length === 1 ? '' : 's'} on record did not come this time: ${some(missing.map((b) => b.name))}.`);

  const count = (list, key) => list.reduce((s, a) => s + (Array.isArray(a[key]) ? a[key].length : Number(a[key]) || 0), 0);
  const hadHoldings = count(before, 'holdings'), gotHoldings = count(snapshot.accounts, 'holdings');
  if (hadHoldings >= 5 && gotHoldings < 0.6 * hadHoldings) warnings.push(`Holdings dropped from ${hadHoldings} to ${gotHoldings}.`);

  const hadTxns = count(before, 'transactions'), gotTxns = count(snapshot.accounts, 'transactions');
  if (hadTxns >= 20 && gotTxns < 0.6 * hadTxns) warnings.push(`Transactions dropped from ${hadTxns.toLocaleString('en-US')} on record to ${gotTxns.toLocaleString('en-US')} this time.`);
  else {
    const silent = before.filter((b) => (b.recent ?? b.transactions) >= 3 && arrived.has(b.id) && !(arrived.get(b.id).transactions?.length));
    if (silent.length) warnings.push(`No transactions came for ${some(silent.map((b) => b.name))}, which ${silent.length === 1 ? 'has' : 'have'} recent ones on record.`);
  }

  const emptied = before.filter((b) => b.holdings >= 1 && arrived.has(b.id) && !(arrived.get(b.id).holdings?.length) && arrived.get(b.id).balance);
  if (emptied.length && !(hadHoldings >= 5 && gotHoldings < 0.6 * hadHoldings)) warnings.push(`No holdings came for ${some(emptied.map((b) => b.name))}, which had some last time.`);

  for (const a of snapshot.accounts) {
    if (!a.holdings?.length || !a.balance) continue;
    const sum = a.holdings.reduce((s, h) => s + (Number(h.value) || 0), 0);
    if (Math.abs(sum - a.balance) > Math.max(5, 0.02 * Math.abs(a.balance))) warnings.push(`${a.name}: its holdings add up to ${money(sum)} but its balance is ${money(a.balance)}.`);
  }

  const zeroed = before.filter((b) => Math.abs(b.balance) >= 100 && arrived.has(b.id) && !arrived.get(b.id).balance && (b.type === 'investment' || b.type === 'retirement'));
  if (zeroed.length) warnings.push(`${some(zeroed.map((b) => b.name))} went from a balance to zero.`);
  return warnings;
}
