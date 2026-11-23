// The bridge: how the dashboard asks the browser extension to do something.
//
//   dashboard ──POST /api/refresh──▶ this server ◀──long poll /ext/poll── extension ──▶ your Chrome tabs
//                                               ◀──/ext/progress────────
//
// The extension keeps a request open to the server; a command is the answer to it. The server
// never reaches into the browser, and nothing here leaves 127.0.0.1.
const queue = [];        // commands waiting for the extension
const waiting = [];      // open polls waiting for a command
let lastSeen = 0, known = [], signIn = [], version = null, runs = 0;

/** What is happening per institution: { state: queued | working | done | needs-login | failed, message, warnings, at } */
export const progressBy = {};

export const extension = () => ({ connected: Date.now() - lastSeen < 45_000, sites: known, signIn, version });   // signIn: the sites it can log in to with a saved login
export const active = () => Object.values(progressBy).some((p) => p.state === 'queued' || p.state === 'working');

export function poll(res, sites, canSignIn, v, send) {
  lastSeen = Date.now();
  if (sites) { known = sites; signIn = canSignIn ?? []; version = v ?? null; }
  if (queue.length) return send(queue.shift());
  const entry = { send, timer: setTimeout(() => { waiting.splice(waiting.indexOf(entry), 1); send({}); }, 25_000) };
  waiting.push(entry);
  res.on('close', () => { clearTimeout(entry.timer); const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); });
}

export function command(cmd) {
  queue.push(cmd);
  while (queue.length && waiting.length) { const w = waiting.shift(); clearTimeout(w.timer); w.send(queue.shift()); }
}

export function setProgress(site, state, message = '', warnings = []) {
  progressBy[site] = { state, message, warnings, at: new Date().toISOString() };
}

export const nextRun = () => ++runs;

// A command the extension never picked up should not show as "queued" for ever.
setInterval(() => {
  for (const [site, p] of Object.entries(progressBy)) {
    const age = Date.now() - Date.parse(p.at);
    if (p.state === 'queued' && age > 40_000) setProgress(site, 'failed', 'The browser extension did not pick this up. Is Chrome open with the coincell extension loaded?');
    if (p.state === 'working' && age > 10 * 60_000) setProgress(site, 'failed', 'This took too long and was given up on.');
  }
}, 5000).unref();
