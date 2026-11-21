// Newrez (mortgage), read from the dashboard as it shows on screen: each loan card's principal
// balance, monthly payment and next payment date. Nothing is loaded or clicked.
// Written from a masked recording of the page's layout. Not read yet: the interest rate and the
// payment history, which live on other pages.
globalThis.__coincellSite = async () => {
  const { parseMoney, text } = globalThis.coincell;
  const cards = [...document.querySelectorAll('mad-servicing-loan-card, .servicing-loan-cards .loan-card')].filter((el, i, all) => !all.some((other) => other !== el && other.contains(el)));
  const accounts = [];
  for (const card of cards) {
    const number = text(card.querySelector('.loan-card__number')).replace(/\D/g, '');
    // The card carries a phone layout and a desktop layout with the same figures; read one of them.
    const figures = card.querySelector('.loan-card__bottom.web') ?? card.querySelector('.loan-card__bottom');
    const found = {};
    for (const step of figures?.querySelectorAll('.loan-card__current-step') ?? []) {
      const value = text(step.querySelector('.loan-card__mortagepayment')), label = text(step).replace(value, '').toLowerCase();
      if (/principal|balance/.test(label)) found.balance = parseMoney(value);
      else if (/next|due/.test(label)) found.due = value;
      else if (/payment/.test(label)) found.payment = parseMoney(value);
    }
    if (!number || found.balance == null) continue;
    const due = found.due ? new Date(found.due) : null;   // "Dec 01, 2026"
    const p = (n) => String(n).padStart(2, '0');
    accounts.push({ id: number.slice(-8), name: 'Mortgage', type: 'loan', mask: number.slice(-4), balance: -Math.abs(found.balance),
      dueAmount: found.payment ?? null, dueDate: due && !Number.isNaN(due.getTime()) ? `${due.getFullYear()}-${p(due.getMonth() + 1)}-${p(due.getDate())}` : null });
  }
  if (!accounts.length) throw new Error('No loan is showing. Log in to Newrez, open the dashboard that lists your loan, then press the button again.');
  return { accounts };
};
