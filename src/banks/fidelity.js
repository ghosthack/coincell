// Fidelity, by file import. Fidelity refuses automated browsers, so this reads the CSV files
// its own website lets you download:
//   Positions tab          -> Portfolio_Positions_<date>.csv   (balances and holdings)
//   Activity & Orders tab  -> Accounts_History.csv or History_for_Account_<n>.csv  (transactions)
// Download them in your normal browser and leave them in ~/Downloads (or in an imports/ folder
// inside this project). "Sync" picks up the newest of each. Nothing is uploaded anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../paths.js';
import { parseMoney } from '../browser.js';
import { parseCsv } from '../csv.js';
import { mdyToIso } from '../history.js';

const folders = () => (process.env.COINCELL_IMPORTS ? [process.env.COINCELL_IMPORTS] : [path.join(ROOT, 'imports'), path.join(os.homedir(), 'Downloads')]);

function newest(pattern) {
  let best = null;
  for (const dir of folders()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!pattern.test(name)) continue;
      const file = path.join(dir, name), mtime = fs.statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) best = { file, mtime };
    }
  }
  return best;
}

// What each line of the activity file is, from the words its "Action" starts with.
const ACTIONS = [
  [/^YOU BOUGHT|^REINVESTMENT|^PURCHASE/i, 'Buy'],
  [/^YOU SOLD|^REDEMPTION/i, 'Sell'],
  [/^DIVIDEND|^LONG-TERM CAP GAIN|^SHORT-TERM CAP GAIN|^DISTRIBUTION|^RETURN OF CAPITAL/i, 'Dividend'],
  [/^INTEREST/i, 'Interest'],
  [/FEE/i, 'Fee'],
  [/^FOREIGN TAX|TAX W\/H|TAX WITHHELD/i, 'Tax'],
  [/^PARTIC CONTR|^CO CONTR|^CONTRIBUTION/i, 'Contribution'],
  [/^DIRECT DEPOSIT|^ELECTRONIC FUNDS TRANSFER RECEIVED|^DEPOSIT|^CHECK RECEIVED|^TRANSFERRED FROM|^CASH CONTRIBUTION/i, 'Deposit'],
  [/^ELECTRONIC FUNDS TRANSFER PAID|^TRANSFERRED TO|^WITHDRAWAL|^DIRECT DEBIT|^BILL PAYMENT|^CHECK PAID|^DEBIT CARD/i, 'Withdrawal'],
];
const RETIREMENT = /\bIRA\b|ROTH|ROLLOVER|401|403|457|PENSION|\bSEP\b|RETIREMENT/i;
const isCash = (symbol, description) => /\*\*$/.test(symbol) || /^(CORE|CASH)\b|MONEY MARKET|HELD IN (MONEY MARKET|FCASH)/i.test(description);

export default {
  id: 'fidelity', name: 'Fidelity', needsBrowser: false,
  viaExtension: true,   // normally fed by the browser extension; this file import is the fallback, run by name
  async sync({ log }) {
    const positionsFile = newest(/^Portfolio_Positions.*\.csv$/i);
    const historyFile = newest(/^(Accounts_History|History_for_Account).*\.csv$/i);
    if (!positionsFile) {
      throw new Error(`No Fidelity positions file found. On fidelity.com open Positions, press the download icon, and leave Portfolio_Positions_<date>.csv in ${folders().join(' or ')}`);
    }
    const age = (f) => Math.round((Date.now() - f.mtime) / 86_400_000);
    log(`Positions: ${path.basename(positionsFile.file).replace(/\d/g, '#')} (${age(positionsFile)} days old)`);

    const accounts = new Map();
    for (const r of parseCsv(fs.readFileSync(positionsFile.file, 'utf8'), 'Account Number')) {
      const number = r['Account Number'];
      if (!number || !/\d/.test(number) || !r['Account Name']) continue;   // blank lines and the legal text at the end
      const value = parseMoney(r['Current Value']);
      if (value == null) continue;
      const a = accounts.get(number) ?? { id: number, name: r['Account Name'], mask: number.slice(-4), balance: 0, holdings: new Map(), transactions: [],
        type: RETIREMENT.test(r['Account Name']) ? 'retirement' : 'investment' };
      accounts.set(number, a);
      a.balance += value;
      const cash = isCash(r.Symbol ?? '', r.Description ?? '') || !r.Symbol || /pending activity/i.test(r.Symbol);
      const symbol = cash ? 'CASH' : r.Symbol;
      const h = a.holdings.get(symbol) ?? { symbol, name: cash ? 'Cash & money market' : r.Description, quantity: 0, value: 0, costBasis: null };
      a.holdings.set(symbol, h);
      h.value += value;
      h.quantity += cash ? value : parseMoney(r.Quantity) ?? 0;
      if (!cash) { h.price = parseMoney(r['Last Price']); const cost = parseMoney(r['Cost Basis Total']); if (cost != null) h.costBasis = (h.costBasis ?? 0) + cost; }
      else h.price = 1;
    }
    if (!accounts.size) throw new Error('The positions file had no account rows. Was it downloaded from the Positions tab with "All accounts" selected?');

    let unknown = 0, count = 0;
    if (historyFile) {
      log(`Activity: ${path.basename(historyFile.file).replace(/\d/g, '#')} (${age(historyFile)} days old)`);
      for (const r of parseCsv(fs.readFileSync(historyFile.file, 'utf8'), 'Run Date')) {
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(r['Run Date'] ?? '')) continue;
        const a = accounts.get(r['Account Number']);
        const amount = parseMoney(r['Amount ($)'] ?? r.Amount);
        if (!a) { unknown++; continue; }      // activity for an account that is not in the positions file
        if (amount == null || amount === 0) continue;   // share-only lines such as mergers and spin-offs move no cash
        a.transactions.push({ date: mdyToIso(r['Run Date']), description: r.Action.replace(/\s+/g, ' '), amount,
          category: ACTIONS.find(([re]) => re.test(r.Action))?.[1] ?? 'Other' });
        count++;
      }
    } else log('No activity file found (Accounts_History.csv); balances and holdings only');

    const out = [...accounts.values()].map((a) => ({ ...a, balance: Math.round(a.balance * 100) / 100, holdings: [...a.holdings.values()] }));
    log(`${out.length} accounts, ${out.reduce((s, a) => s + a.holdings.length, 0)} holdings, ${count} transactions${unknown ? `, ${unknown} activity lines skipped for accounts not in the positions file` : ''}`);
    return { accounts: out };
  },
};
