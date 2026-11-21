<p align="center"><img src="icon/coincell.png" width="160" alt="A polished 3D lithium coin cell with a plus sign and the word coincell stamped into its face"></p>

<h1 align="center">coincell</h1>

A local dashboard for your own money. It logs in to each of your banks, cards, brokers and lenders with a
real browser, reads balances, holdings and transactions, and shows them together: net worth over time, cash
flow, upcoming payments, and an Insights tab with suggestions and charts. Everything stays on your machine.

It has two modes that never share data:

- **Demo** (`npm run demo`): five made-up institutions in `fakebanks/`, so the whole thing can be run and
  tested end to end without real accounts. Data lives in `.data-demo/`, dashboard on port 4690.
- **Real** (`npm start`): your own institutions, added one at a time from the template. Data lives in
  `.data/`, dashboard on port 4680. It starts empty.

![Overview tab](docs/overview.png)

<details><summary>Insights tab</summary>

![Insights tab](docs/insights.png)

</details>

## Run it

```sh
npm install
npx playwright install chromium   # only if Google Chrome is not installed
npm run demo                      # http://localhost:4690, then press "Sync now"
```

- `npm run demo`: start the made-up institutions (ports 4701-4705) and the demo dashboard together.
  Harborline Bank (checking + savings), Kestrel Card, Copperleaf Card, Meridian Wealth (brokerage, Roth IRA, 401(k))
  and Lakeshore Home Loans (mortgage). Their logins are filled in automatically.
- `npm run demo:sync`: sync every demo institution from the command line (same as the "Sync now" button).
- `npm run demo:verify`: after a sync, compare what was scraped with what the fake institutions really hold.
- `npm start`: the dashboard for your real institutions.
- `npm run sync -- all`: sync every real institution from the command line, or name one.
- `npm run record -- <login url>`: log in by hand and click around; writes the shape of every JSON call the bank's site makes (values redacted) to `.data/recordings/`. Use it to write an adapter.

## Insights tab

A suggestions panel and charts (saved vs market, a money flow diagram, a spending calendar, the cash runway,
mortgage payoff curves, and a projection of when investments could cover spending), plus tables for:
savings rate, net worth change split into saved vs market, spending by category and payee, recurring bills,
cash runway, asset allocation, transactions worth a second look, and debt payoff. The rules behind them are in
`insights-config.json`: spending categories (first matching pattern wins), asset class per symbol, allocation
targets, the low-balance warning level, and the extra mortgage payment scenarios. Edit and reload; nothing is stored.
`manual-assets.json` holds values no website reports, such as your home. Copy `manual-assets.example.json` to
create it; it is git-ignored because it is about you.

## Adding a bank

Copy `src/banks/mybank.js`, fill in the TODOs, and add it to the `REAL` list in `src/banks/index.js`. An adapter returns
`{ accounts: [{ id, name, type, balance, holdings?, transactions?, history?, dueAmount?, dueDate? }] }`;
debts are negative balances and money going out is a negative amount. The demo adapters in `src/banks/demo/`
show four techniques: page scraping, listening to the site's JSON, CSV export, and calling the site's API.

Browser automation may be against an institution's terms of use, and some block automated browsers. Check before relying on it.

## Where things live

- `.data/coincell.sqlite`: all synced data. `.data/profiles/`: the browser profile per bank (session cookies).
  Both stay on this machine and are git-ignored. Treat `.data/` like a password file.
- `.data-demo/`: the same for demo mode. Safe to delete at any time.
- You type your password and 2FA codes into the bank's own page in a visible browser window. The app never reads or stores them.
- The server listens on 127.0.0.1 only.

## Icon

The icon is a 3D coin cell modelled in three.js and lit like a product photo. Edit `icon/scene.js`, then `cd icon && npm ci && node build.js`.

## Licence

[MIT](LICENSE).
