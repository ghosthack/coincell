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

export const TARGETS = { demo: 'http://localhost:4690', real: 'http://localhost:4680' };

export const SITES = [
  { id: 'fidelity', name: 'Fidelity', match: /^https:\/\/digital\.fidelity\.com\//, capture: fidelity, target: 'real' },
  { id: 'chase', name: 'Chase', match: /^https:\/\/secure\.chase\.com\//, capture: chase, target: 'real' },
  { id: 'ally', name: 'Ally Bank', match: /^https:\/\/secure\.ally\.com\//, capture: ally, target: 'real' },
  { id: 'newrez', name: 'Newrez', match: /^https:\/\/myaccount\.newrez\.com\//, file: 'sites/newrez.js', target: 'real' },
  { id: 'harborline', name: 'Harborline Bank (demo)', match: /^http:\/\/localhost:4701\//, file: 'sites/demo/harborline.js', target: 'demo' },
  { id: 'kestrel', name: 'Kestrel Card (demo)', match: /^http:\/\/localhost:4702\//, capture: kestrel, target: 'demo' },
  { id: 'copperleaf', name: 'Copperleaf Card (demo)', match: /^http:\/\/localhost:4703\//, file: 'sites/demo/copperleaf.js', target: 'demo' },
  { id: 'meridian', name: 'Meridian Wealth (demo)', match: /^http:\/\/localhost:4704\//, file: 'sites/demo/meridian.js', target: 'demo' },
  { id: 'lakeshore', name: 'Lakeshore Home Loans (demo)', match: /^http:\/\/localhost:4705\//, file: 'sites/demo/lakeshore.js', target: 'demo' },
];

export const siteFor = (url) => SITES.find((s) => s.match.test(url ?? ''));
export const targetFor = (url) => TARGETS[siteFor(url)?.target ?? (/^http:\/\/localhost[:/]/.test(url ?? '') ? 'demo' : 'real')];
