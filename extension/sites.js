// The sites this extension can read, and which coincell each one reports to.
// `match` is tested against the tab's URL; `file` is the script that collects the data.
// To add a real institution: add its https origin here and write its script in sites/.
export const TARGETS = { demo: 'http://localhost:4690', real: 'http://localhost:4680' };

export const SITES = [
  { id: 'harborline', name: 'Harborline Bank (demo)', match: /^http:\/\/localhost:4701\//, file: 'sites/demo/harborline.js', target: 'demo' },
  { id: 'kestrel', name: 'Kestrel Card (demo)', match: /^http:\/\/localhost:4702\//, file: 'sites/demo/kestrel.js', target: 'demo' },
  { id: 'copperleaf', name: 'Copperleaf Card (demo)', match: /^http:\/\/localhost:4703\//, file: 'sites/demo/copperleaf.js', target: 'demo' },
  { id: 'meridian', name: 'Meridian Wealth (demo)', match: /^http:\/\/localhost:4704\//, file: 'sites/demo/meridian.js', target: 'demo' },
  { id: 'lakeshore', name: 'Lakeshore Home Loans (demo)', match: /^http:\/\/localhost:4705\//, file: 'sites/demo/lakeshore.js', target: 'demo' },
];

export const siteFor = (url) => SITES.find((s) => s.match.test(url ?? ''));
export const targetFor = (url) => TARGETS[siteFor(url)?.target ?? (/^http:\/\/localhost[:/]/.test(url ?? '') ? 'demo' : 'real')];
