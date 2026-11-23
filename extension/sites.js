// The sites this extension can read, and which coincell each one reports to.
// `match` is tested against the tab's URL. A site is read in one of two ways:
//   file:    a script that asks the site for its pages and data directly (see sites/demo/)
//   capture: opens the site's own pages in the tab and uses the answers they receive; for sites
//            whose data feeds only answer their own pages (see sites/fidelity.js). A step marked
//            `live` starts on the page as it stands, for sites that sign you out on a reload.
// To add a real institution: add it here and write its script in sites/.
import kestrel from './sites/demo/kestrel.js';
import fidelity from './sites/fidelity.js';
import chase from './sites/chase.js';
import ally from './sites/ally.js';
import newrezServicing from './sites/newrez-servicing.js';
import citi from './sites/citi.js';

export const TARGETS = { demo: 'http://localhost:4690', real: 'http://localhost:4680' };

// For the dashboard's "Refresh all" and for syncing when you log in, a site also says:
//   home:     the page to open
//   loggedIn: what the address looks like once you are in (anything else means "needs a login")
//   ownTab:   read it in the tab you already have open, for sites that keep you signed in per tab
// And for signing in with a login saved in coincell (see signin.js):
//   signIn:   the addresses of the site's own sign-in pages; a saved login is filled in nowhere else
//   code:     who the site's emailed codes come from, so only that mail is looked at
//   allow:    other addresses of the site Chrome must be told the extension may use
const sender = (domain) => ({ from: new RegExp(`@([a-z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}$`, 'i') });
export const SITES = [
  { id: 'fidelity', name: 'Fidelity', match: /^https:\/\/digital\.fidelity\.com\//, capture: fidelity, target: 'real',
    home: 'https://digital.fidelity.com/ftgw/digital/portfolio/summary', loggedIn: /^https:\/\/digital\.fidelity\.com\/ftgw\/digital\/portfolio\//,
    signIn: /^https:\/\/digital\.fidelity\.com\/prgw\/digital\/login\//, code: sender('fidelity.com') },
  { id: 'chase', name: 'Chase', match: /^https:\/\/secure\.chase\.com\//, capture: chase, target: 'real',
    home: 'https://secure.chase.com/web/auth/dashboard#/dashboard/overview', loggedIn: /^https:\/\/secure\.chase\.com\/web\/auth\/dashboard#\/dashboard\//,
    signIn: /^https:\/\/secure\.chase\.com\/web\/auth\//, code: sender('chase.com') },
  { id: 'ally', name: 'Ally Bank', match: /^https:\/\/secure\.ally\.com\//, capture: ally, target: 'real',
    home: 'https://secure.ally.com/dashboard', loggedIn: /^https:\/\/secure\.ally\.com\/dashboard/, ownTab: true,
    signIn: /^https:\/\/secure\.ally\.com\//, code: sender('ally.com') },
  { id: 'citi', name: 'Citi', match: /^https:\/\/online\.citi\.com\//, capture: citi, target: 'real',
    home: 'https://online.citi.com/US/ag/dashboard/summary', loggedIn: /^https:\/\/online\.citi\.com\/US\/ag\/dashboard\//,
    signIn: /^https:\/\/(www|online)\.citi\.com\//, code: sender('citi.com'), allow: ['https://www.citi.com/*'] },
  { id: 'newrez', name: 'Newrez', match: /^https:\/\/myaccount\.newrez\.com\//, file: 'sites/newrez.js', target: 'real',
    home: 'https://myaccount.newrez.com/dashboard', loggedIn: /^https:\/\/myaccount\.newrez\.com\/dashboard/,
    signIn: /^https:\/\/myaccount\.newrez\.com\//, code: sender('newrez.com') },
  { id: 'newrez', name: 'Newrez (account details)', match: /^https:\/\/servicing\.newrez\.com\//, capture: newrezServicing, target: 'real',
    loggedIn: /^https:\/\/servicing\.newrez\.com\/servicing\/[^/]+\/(dashboard|payments)/, ownTab: true },
  { id: 'harborline', name: 'Harborline Bank (demo)', match: /^http:\/\/localhost:4701\//, file: 'sites/demo/harborline.js', target: 'demo',
    home: 'http://localhost:4701/accounts', loggedIn: /^http:\/\/localhost:4701\/accounts/,
    signIn: /^http:\/\/localhost:4701\/(login|verify)/, code: sender('harborline.example') },
  { id: 'kestrel', name: 'Kestrel Card (demo)', match: /^http:\/\/localhost:4702\//, capture: kestrel, target: 'demo',
    home: 'http://localhost:4702/', loggedIn: /^http:\/\/localhost:4702\/$/,
    signIn: /^http:\/\/localhost:4702\/login/ },
  { id: 'copperleaf', name: 'Copperleaf Card (demo)', match: /^http:\/\/localhost:4703\//, file: 'sites/demo/copperleaf.js', target: 'demo',
    home: 'http://localhost:4703/overview', loggedIn: /^http:\/\/localhost:4703\/overview/,
    signIn: /^http:\/\/localhost:4703\/(login|remember)/ },
  { id: 'meridian', name: 'Meridian Wealth (demo)', match: /^http:\/\/localhost:4704\//, file: 'sites/demo/meridian.js', target: 'demo',
    home: 'http://localhost:4704/portfolio', loggedIn: /^http:\/\/localhost:4704\/portfolio/,
    signIn: /^http:\/\/localhost:4704\/login/ },
  { id: 'lakeshore', name: 'Lakeshore Home Loans (demo)', match: /^http:\/\/localhost:4705\//, file: 'sites/demo/lakeshore.js', target: 'demo',
    home: 'http://localhost:4705/loan', loggedIn: /^http:\/\/localhost:4705\/loan/,
    signIn: /^http:\/\/localhost:4705\/(signin|challenge)/ },
];

export const siteFor = (url) => SITES.find((s) => s.match.test(url ?? ''));
export const targetFor = (url) => TARGETS[siteFor(url)?.target ?? (/^http:\/\/localhost[:/]/.test(url ?? '') ? 'demo' : 'real')];
