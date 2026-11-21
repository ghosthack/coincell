// One simulated household whose money moves between four fake institutions.
// Everything is a deterministic function of the calendar, starting 2026-06-01,
// so history never changes between runs and a new day just adds to it.
// Amounts here are "net worth effect": a card purchase is negative, a payment
// to the card is positive on the card and negative on checking.
const EPOCH = new Date(2026, 5, 1);
const p2 = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const cents = (n) => Math.round(n * 100) / 100;
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const SECURITIES = {
  VTI: { name: 'Vanguard Total Stock Market ETF', base: 286, amp: 0.05, per: 19, drift: 0.0007 },
  VXUS: { name: 'Vanguard Total International Stock ETF', base: 68, amp: 0.04, per: 23, drift: 0.0004 },
  AAPL: { name: 'Apple Inc.', base: 231, amp: 0.08, per: 11, drift: 0.0009 },
  BND: { name: 'Vanguard Total Bond Market ETF', base: 73, amp: 0.012, per: 29, drift: 0.0001 },
  MTR55: { name: 'Meridian Target Retirement 2055 Fund', base: 48.2, amp: 0.04, per: 23, drift: 0.0006 },
};
function price(sym, n) {
  const s = SECURITIES[sym];
  const noise = (mulberry32(n * 131 + sym.charCodeAt(0) * 17 + sym.length)() - 0.5) * 0.012;
  return cents(s.base * (1 + s.amp * Math.sin(n / s.per + sym.charCodeAt(1)) + s.drift * n + noise));
}

const EVERYDAY = ['GREENLEAF GROCERY #114', 'BLUE BOTTLE COFFEE', 'METRO TRANSIT FARE', 'CORNER PHARMACY', 'SUNRISE BAKERY', 'TACO VERDE', 'SHELL OIL 5521', 'PAPERBACK BOOKS', 'NOODLE HOUSE', 'HOME HARDWARE CO'];
const TRAVEL = ['AMAZON MKTP US, SEATTLE WA', 'SKYLINE AIRWAYS', 'HARBOR VIEW HOTEL', 'RIDESHARE *TRIP', 'OUTDOOR SUPPLY CO, DENVER CO', 'CITY PARKING GARAGE'];

export function buildWorld(now = new Date()) {
  const bank = (inst, name, last4, bal) => ({ inst, name, last4, bal, tx: [] });
  const card = (inst, name, last4, bal, limit) => ({ ...bank(inst, name, last4, bal), limit, statement: { balance: 0, remaining: 0, closeDate: null, dueDate: null } });
  const inv = (name, kind, number, cash, pos) => ({ inst: 'meridian', name, kind, number, cash, pos, tx: [], hist: [] });
  const A = {
    chk: bank('harborline', 'Everyday Checking', '4471', 4200),
    sav: bank('harborline', 'Growth Savings', '9020', 15000),
    kes: card('kestrel', 'Kestrel Cash Rewards Card', '0085', -300, 8000),
    cop: card('copperleaf', 'Copperleaf Travel Card', '7731', -410, 12000),
    brk: inv('Individual Brokerage', 'BROKERAGE', 'Z31-553318', 120.5, { VTI: { sh: 60, cost: 15900 }, VXUS: { sh: 120, cost: 7900 }, AAPL: { sh: 25, cost: 4100 } }),
    ira: inv('Roth IRA', 'ROTH_IRA', 'R18-220764', 35.1, { VTI: { sh: 40, cost: 10300 }, BND: { sh: 90, cost: 6700 } }),
    mtg: { inst: 'lakeshore', name: 'Home Mortgage', number: '0044871236', bal: -291400, rate: 0.0625, pi: 1970.3, escrow: 420, escrowBal: 1900, tx: [], nextDue: null },
    k401: inv('Acme Corp 401(k) Plan', '401K', 'P40-009912', 0, { MTR55: { sh: 1450, cost: 61000 } }),
  };
  const post = (key, date, desc, amount, type) => {
    const a = A[key];
    a.bal = cents(a.bal + amount);
    a.tx.push({ id: `${key.toUpperCase()}${String(a.tx.length + 1).padStart(5, '0')}`, date, desc, amount: cents(amount), type });
    if (a.statement && amount > 0) a.statement.remaining = cents(Math.max(0, a.statement.remaining - amount));
  };
  const invTx = (a, date, type, desc, amount) => a.tx.push({ id: `${a.number.slice(0, 3)}-${a.tx.length + 1001}`, date, type, desc, amount: cents(amount) });
  const deposit = (key, date, amt, desc, type = 'Deposit') => { const a = A[key]; a.cash = cents(a.cash + amt); invTx(a, date, type, desc, amt); };
  const buy = (key, date, n, sym, amt) => {
    const a = A[key], px = price(sym, n), sh = Math.round((amt / px) * 1000) / 1000;
    a.pos[sym].sh = Math.round((a.pos[sym].sh + sh) * 1000) / 1000;
    a.pos[sym].cost = cents(a.pos[sym].cost + amt);
    a.cash = cents(a.cash - amt);
    invTx(a, date, 'Buy', `Bought ${sh} ${sym} @ ${px.toFixed(2)}`, -amt);
  };
  const value = (a, n) => cents(a.cash + Object.entries(a.pos).reduce((s, [sym, p]) => s + p.sh * price(sym, n), 0));

  const later = new Map(); // date -> things that post after a processing delay
  const schedule = (d, days, fn) => { const k = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)); later.set(k, [...(later.get(k) ?? []), fn]); };
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 0;
  for (let d = new Date(EPOCH); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), n++) {
    const date = iso(d), dom = d.getDate(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const r = mulberry32(n * 7919 + 1);
    const day = n;
    for (const fn of later.get(date) ?? []) fn(date, day);

    if (dom === 1) post('chk', date, 'PINEWOOD APARTMENTS RENT', -1450, 'ACH'); // rents where they live, owns another property
    if (dom === 1) { // mortgage: one debit from checking, split by the servicer into principal, interest and escrow
      const m = A.mtg, total = cents(m.pi + m.escrow);
      post('chk', date, 'LAKESHORE HOME LOANS MTG PYMT', -total, 'ACH');
      m.nextDue = iso(new Date(d.getFullYear(), d.getMonth() + 1, 1));
      schedule(d, 1, (dt) => {
        const interest = cents((-m.bal * m.rate) / 12), principal = cents(m.pi - interest);
        m.bal = cents(m.bal + principal); m.escrowBal = cents(m.escrowBal + m.escrow);
        m.tx.push({ id: `PMT${String(m.tx.length + 1).padStart(4, '0')}`, date: dt, total, principal, interest, escrow: m.escrow, balanceAfter: -m.bal });
      });
    }
    if (dom === 3) { // monthly investing: money leaves checking today, arrives at the broker tomorrow
      post('chk', date, 'MERIDIAN WEALTH ACH TRANSFER', -400, 'ACH');
      schedule(d, 1, (dt, dn) => { deposit('brk', dt, 400, 'Electronic funds transfer from bank ••4471'); buy('brk', dt, dn, 'VTI', 400); });
      post('chk', date, 'MERIDIAN WEALTH IRA CONTRIBUTION', -250, 'ACH');
      schedule(d, 1, (dt, dn) => { deposit('ira', dt, 250, 'IRA contribution from bank ••4471'); buy('ira', dt, dn, 'VTI', 250); });
    }
    if (dom === 12) {
      post('chk', date, 'CITY POWER & WATER', -cents(110 + r() * 60), 'ACH');
      const due = A.kes.statement.remaining; // autopay the full statement
      if (due > 0) { post('chk', date, 'KESTREL CARD AUTOPAY', -due, 'ACH'); schedule(d, 1, (dt) => post('kes', dt, 'PAYMENT RECEIVED - THANK YOU', due, 'PAYMENT')); }
    }
    if (dom === 15 || dom === dim) {
      post('chk', date, 'ACME CORP PAYROLL', 3900, 'Direct deposit');
      deposit('k401', date, 420, 'Employee contribution', 'Contribution'); deposit('k401', date, 210, 'Employer match', 'Contribution');
      buy('k401', date, day, 'MTR55', 630);
    }
    if (dom === 16) { post('chk', date, 'Transfer to Savings ••9020', -500, 'Transfer'); post('sav', date, 'Transfer from Checking ••4471', 500, 'Transfer'); }
    if (dom === 28) {
      const due = A.cop.statement.remaining;
      if (due > 0) { post('chk', date, 'COPPERLEAF CARD PYMT', -due, 'ACH'); schedule(d, 1, (dt) => post('cop', dt, 'ONLINE PAYMENT, THANK YOU', due, 'Payment')); }
    }
    if (r() < 0.06) post('chk', date, 'ATM WITHDRAWAL 3RD & MAIN', -60, 'ATM');

    // Subscriptions on the Kestrel card: one raises its price, one is new, one was cancelled.
    const subscription = (day_, desc, amt, from = '0000', to = '9999') => { if (dom === day_ && date >= from && date <= to) post('kes', date, desc, -amt, 'PURCHASE'); };
    subscription(8, 'STREAMFLIX.COM', date < '2026-10-01' ? 15.99 : 17.99);
    subscription(2, 'IRONWORKS GYM MEMBERSHIP', 39);
    subscription(21, 'CLOUDBOX STORAGE', 2.99);
    subscription(18, 'NEWSWIRE DIGITAL', 12, '2026-10-01');
    subscription(10, 'PUZZLE CLUB BOX', 24.5, '0000', '2026-09-30');
    // A few things that deserve a second look.
    if (date === '2026-11-14') { post('cop', date, 'HARBOR VIEW HOTEL', -189.4, 'Sale'); post('cop', date, 'HARBOR VIEW HOTEL', -189.4, 'Sale'); }
    if (date === '2026-11-15') post('cop', date, 'FOREIGN TRANSACTION FEE', -5.68, 'Fee');
    if (date === '2026-11-09') post('kes', date, 'GREENLEAF GROCERY #114', -412.87, 'PURCHASE');
    if (date === '2026-10-20') post('chk', date, 'MONTHLY MAINTENANCE FEE', -12, 'Fee');

    const k = r(), count = k < 0.35 ? 0 : k < 0.75 ? 1 : k < 0.93 ? 2 : 3;
    for (let i = 0; i < count; i++) post('kes', date, EVERYDAY[Math.floor(r() * EVERYDAY.length)], -cents(6 + r() * 69), 'PURCHASE');
    if (r() < 0.25) post('cop', date, TRAVEL[Math.floor(r() * TRAVEL.length)], -cents(25 + r() * 165), 'Sale');

    if (dom === dim) post('sav', date, 'INTEREST PAYMENT', cents((A.sav.bal * 0.041) / 12), 'Interest');
    const close = (c, dueDate) => { c.statement = { balance: cents(-c.bal), remaining: cents(Math.max(0, -c.bal)), closeDate: date, dueDate }; };
    if (dom === 20) close(A.kes, iso(new Date(d.getFullYear(), d.getMonth() + 1, 15)));
    if (dom === 5) close(A.cop, iso(new Date(d.getFullYear(), d.getMonth(), 30)));
    for (const key of ['brk', 'ira', 'k401']) A[key].hist.push({ date, value: value(A[key], day) });
  }
  const last = n - 1;
  for (const key of ['brk', 'ira', 'k401']) {
    const a = A[key];
    a.positions = Object.entries(a.pos).map(([ticker, p]) => ({ ticker, description: SECURITIES[ticker].name, shares: p.sh, lastPrice: price(ticker, last), marketValue: cents(p.sh * price(ticker, last)), costBasis: p.cost }));
    a.total = value(a, last);
  }
  return { today: iso(end), accounts: A };
}
