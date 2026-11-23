// Saved logins, for the extension to fill in on a site's own sign-in page.
//
// Real mode keeps them in the macOS Keychain (service "coincell", one item per institution), so
// they are encrypted with your Mac login and never sit in a file in this folder. Demo mode, where
// the only logins are the made-up banks' public ones, uses a file in the demo data folder.
//
// A password goes in through the form on the dashboard and comes out only to the extension
// (GET /ext/login). No other route returns it, and it is never logged.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { DEMO, dataPath } from './paths.js';

const SERVICE = 'coincell';
const SECURITY = '/usr/bin/security';
const okId = (site) => /^[a-z0-9-]{1,40}$/.test(site);

const file = {
  path: () => dataPath('logins.json'),
  all() { try { return JSON.parse(fs.readFileSync(this.path(), 'utf8')); } catch { return {}; } },
  get(site) { return this.all()[site] ?? null; },
  set(site, value) { const all = this.all(); if (value) all[site] = value; else delete all[site]; fs.writeFileSync(this.path(), JSON.stringify(all), { mode: 0o600 }); },
};

const keychain = {
  get(site) {
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', site, '-w'], { encoding: 'utf8' });
    if (r.status !== 0) { if (/interaction is not allowed/i.test(r.stderr)) throw new Error(LOCKED); return null; }
    try { return JSON.parse(Buffer.from(r.stdout.trim(), 'base64').toString('utf8')); } catch { return null; }
  },
  set(site, value) {
    if (!value) return void spawnSync(SECURITY, ['delete-generic-password', '-s', SERVICE, '-a', site]);
    // Through the tool's standard input, so the secret never shows in the list of running programs.
    const secret = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
    const r = spawnSync(SECURITY, ['-i'], { input: `add-generic-password -U -s ${SERVICE} -a ${site} -w ${secret}\n`, encoding: 'utf8' });
    if (r.status !== 0 || /returned -?\d+/.test(r.stderr)) throw new Error(/interaction is not allowed/i.test(r.stderr) ? LOCKED : 'The Keychain did not accept the login.');
  },
};
const LOCKED = 'The Keychain is not available to coincell. Start coincell from your own desktop session (npm run service), not over SSH.';

const store = DEMO || process.platform !== 'darwin' ? file : keychain;
export const storeName = store === keychain ? 'the macOS Keychain' : DEMO ? 'the demo data folder' : 'a file readable only by you (.data/logins.json)';

export function saveLogin(site, username, password) {
  if (!okId(site)) throw new Error('Unknown institution');
  if (!username || !password) throw new Error('Both a username and a password are needed');
  store.set(site, { username: String(username), password: String(password), savedAt: new Date().toISOString() });
}
export function removeLogin(site) { if (okId(site)) store.set(site, null); }
export function getLogin(site) { return okId(site) ? store.get(site) : null; }
/** When a login was saved, or null. Never the login itself. */
export function loginSavedAt(site) { try { return getLogin(site)?.savedAt ?? null; } catch { return null; } }

// ---- settings that are not secret ----
const settingsPath = () => dataPath('settings.json');
export const getSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; } };
export const saveSettings = (patch) => { const next = { ...getSettings(), ...patch }; fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); return next; };

/** Where the extension looks for emailed sign-in codes. */
export function codesInbox() {
  if (DEMO) return { address: 'demo@mail.example', feeds: ['http://localhost:4706/mail/u/0/feed/atom'] };
  const address = String(getSettings().codesInbox ?? '').trim().toLowerCase();
  // Gmail numbers the accounts a browser is signed in to. With an inbox named, the extension picks
  // the one whose feed names that address; with none named, it uses the first.
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) return { address: '', feeds: ['https://mail.google.com/mail/u/0/feed/atom'] };
  return { address, feeds: [0, 1, 2, 3, 4].map((n) => `https://mail.google.com/mail/u/${n}/feed/atom`) };
}
