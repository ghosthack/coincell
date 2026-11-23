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

- `npm run demo`: start the made-up institutions (ports 4701-4705, and a demo inbox on 4706) and the demo dashboard together.
  Harborline Bank (checking + savings), Kestrel Card, Copperleaf Card, Meridian Wealth (brokerage, Roth IRA, 401(k))
  and Lakeshore Home Loans (mortgage). Their logins are filled in automatically.
- `npm run demo:sync`: sync every demo institution from the command line (same as the "Sync now" button).
- `npm run demo:verify`: after a sync, compare what was scraped with what the fake institutions really hold.
- `npm run demo:test-extension`: test the browser extension end to end against the fake institutions.
- `npm start`: the dashboard for your real institutions.
- `npm run sync -- all`: sync every real institution from the command line, or name one.
- `npm run record -- <login url>`: log in by hand and click around; writes the shape of every JSON call the bank's site makes (values redacted) to `.data/recordings/`. Use it to write an adapter.

## Browser extension

Some institutions refuse automated browsers. The extension in `extension/` works from your everyday Chrome
instead: you log in to a site yourself, press the coincell button, and it collects your balances, holdings and
activity from that site and hands them to coincell on the same computer. Nothing leaves your machine.

1. Open `chrome://extensions`, switch on **Developer mode**, press **Load unpacked** and choose the `extension` folder.
2. Start coincell (`npm run demo` for the made-up sites, `npm start` for real ones).
3. Log in to a site, then press the coincell icon and **Send this site**, or **Send all open sites** to do every
   open tab at once.

The dashboard and the extension also talk to each other. **Refresh all** on the dashboard asks the extension to
open each institution in a background tab and read it; one you are not logged in to is left open on its login
page and marked as needing a login. And logging in to a known site is itself the cue to read it, with nothing to
press (the popup has a switch for this). The Institutions table on the dashboard shows where each one stands.

#### Signing in for you

Sessions at banks run out within the hour, so a refresh usually finds a login page. coincell can sign in itself:

1. Run coincell as a login item with `npm run service`, so the macOS Keychain is available to it.
2. On the dashboard's **Settings** tab, press **Save a login…** for each institution. The login is kept in the
   macOS Keychain (service `coincell`) and never in this folder.
3. If a site emails sign-in codes, have them all arrive in one Gmail inbox and sign in to that inbox in the same
   Chrome. If that Chrome is signed in to several Gmail accounts, name the inbox on the Settings tab.
4. Press **Allow sign-in help** in the extension's popup. Chrome asks you to confirm.

From then on a refresh fills the saved login in on the site's own sign-in page, enters an emailed code, and
accepts "remember this device" where offered. The limits are deliberate:

- A login is filled in only on addresses listed as that site's sign-in pages in `extension/sites.js`.
- A login the site turns down is tried once and not again until you save it anew, so nothing can lock your account.
- Only Gmail's feed of unread mail is read, only mail from the site's own sender is looked at, and none of it is kept.
- A text message, an app prompt, a security question or a puzzle is left to you: the tab stays open and the site
  is read as soon as you are in.
- Fields are set the plain way and the page is told about it. Nothing pretends to be a person, and nothing hides
  that a program is filling in the form. A site that objects will say so, and then that login stays yours to do.

Any program running as you on this computer could ask coincell for a saved login, just as it could ask the
Keychain. Web pages cannot.

For a site coincell does not know yet, press **Start recording this site**, browse your accounts, positions and
activity pages, and stop. The recording goes to `.data/recordings/` and holds the layout of the site's pages and
data with every value masked; it is what a new site script is written from. Site scripts live in
`extension/sites/` and are listed in `extension/sites.js`.

Sites change, and a script can start bringing less without failing outright. Each import is compared with what
was on record: missing accounts, a sharp drop in holdings or transactions, or holdings that no longer add up to
the balance show as warnings in the popup. Every send also leaves a record in `.data/recordings/` of which of the
site's services answered, with no financial data, which is the first thing to read when something breaks.

`npm run demo:test-extension` runs the whole thing against the made-up institutions and checks the result.

## Insights tab

A suggestions panel and charts (saved vs market, a money flow diagram, a spending calendar, the cash runway,
mortgage payoff curves, and a projection of when investments could cover spending), plus tables for:
savings rate, net worth change split into saved vs market, spending by category and payee, recurring bills,
cash runway, asset allocation, transactions worth a second look, and debt payoff. The rules behind them are in
`insights-config.json` (the demo has its own copy in `fakebanks/`): spending categories (first matching pattern wins), asset class per symbol, allocation
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
