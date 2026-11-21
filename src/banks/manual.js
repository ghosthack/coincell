// Things no website reports, such as what your home is worth. Copy manual-assets.example.json
// to manual-assets.json (it is git-ignored, since it is about you) and edit it:
//   [{ "id": "home", "name": "Home (my estimate)", "type": "property", "balance": 415000, "since": "2026-06-01" }]
// `since` (optional) draws the value as a flat line back to that date.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DEMO, today } from '../paths.js';

export default {
  id: 'manual', name: 'Entered by hand', needsBrowser: false,
  async sync({ log }) {
    const file = DEMO ? path.join(ROOT, 'fakebanks', 'manual-assets.json') : path.join(ROOT, 'manual-assets.json');
    if (!fs.existsSync(file)) return { accounts: [] };
    const accounts = JSON.parse(fs.readFileSync(file, 'utf8')).map((a) => {
      const history = [];
      if (a.since) for (let d = new Date(`${a.since}T12:00:00`); today(d) < today(); d.setDate(d.getDate() + 1)) history.push({ date: today(d), balance: a.balance });
      return { id: a.id, name: a.name, type: a.type ?? 'property', balance: a.balance, history };
    });
    log(`${accounts.length} manual entr${accounts.length === 1 ? 'y' : 'ies'}`);
    return { accounts };
  },
};
