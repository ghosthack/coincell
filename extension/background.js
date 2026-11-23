// Runs the site scripts in your tabs and hands what they collect to coincell on this computer.
import { SITES, TARGETS, siteFor, targetFor } from './sites.js';
import { signIn } from './signin.js';

async function post(base, path, body) {
  let res;
  try {
    res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`coincell is not running at ${base}. Start it with "${base === TARGETS.demo ? 'npm run demo' : 'npm start'}".`);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `coincell answered ${res.status}`);
  return out;
}

// Field names and types with every value removed. For a list, the fields of ALL its items are
// merged, since rows of different kinds carry different fields. The only values kept are short
// labels in fields named "...Type", which say what kind of row something is.
const shapeOf = (v, depth = 0, key = '') => {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (!v.length) return [];
    if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const merged = {}, labels = {};
      for (const item of v) for (const [k, x] of Object.entries(item)) {
        const name = k.replace(/[0-9]{4,}/g, '#');
        if (/type$/i.test(k) && typeof x === 'string' && /^[A-Za-z _-]{1,24}$/.test(x)) { (labels[name] ??= new Set()).add(x); continue; }
        const s = shapeOf(x, depth + 1, k);
        if (!(name in merged) || merged[name] === 'null') merged[name] = s;
        else if (s && typeof s === 'object' && !Array.isArray(s) && typeof merged[name] === 'object') merged[name] = { ...s, ...merged[name] };
      }
      for (const [k, set] of Object.entries(labels)) merged[k] = `one of: ${[...set].slice(0, 12).join(' | ')}`;
      return [merged, `(${v.length} items)`];
    }
    return [shapeOf(v[0], depth + 1), `(${v.length} items)`];
  }
  if (typeof v === 'object') return depth > 9 ? '{...}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/[0-9]{4,}/g, '#'), shapeOf(x, depth + 1, k)]));
  if (typeof v === 'string') return /^-?[\d,.]+$/.test(v) ? 'numeric-string' : 'string';
  return typeof v;
};
const LOGIN_FIRST = 'You are not logged in to this site. Log in, then press the button again.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inPage = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args }))[0].result;

/** Read a site by asking it directly from inside the tab. */
async function readDirect(tab, site) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib.js', site.file] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id },
    func: async () => { try { return { snapshot: await globalThis.__coincellSite() }; } catch (e) { return { error: e.message }; } } });
  if (result.error) throw new Error(result.error);
  return result.snapshot;
}

/** Read a site by opening its own pages in the tab and collecting the answers they receive. */
async function readByCapture(tab, site, log) {
  const origin = new URL(tab.url).origin, id = `capture_${site.id}`, plan = site.capture;
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: ['capture-main.js'], world: 'MAIN', runAt: 'document_start' }]);
  try {
    const captured = log.captured, shared = {};   // `shared` carries what one step learned on to the next page
    // Steps run in order. A step may add more once it knows what there is to visit (one page per account, say).
    const queue = [...plan.steps];
    for (let step = queue.shift(); step; step = queue.shift()) {
      log.steps.push(step.live ? 'live page' : step.here ? 'reload of the current page' : step.go.replace(/=[^&]{12,}/g, '=:token'));
      if (step.live) {   // no loading of pages: start capturing on the page as it is, and let the step drive it
        if (plan.loggedOut?.test(new URL(tab.url).pathname + new URL(tab.url).hash)) throw new Error(LOGIN_FIRST);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture-main.js'], world: 'MAIN' });
        const outcome = await inPage(tab.id, step.act, [shared]);
        if (outcome?.error) throw new Error(outcome.error);
        if (outcome && typeof outcome === 'object') Object.assign(shared, outcome);
        if (outcome?.detail) (log.asked ??= []).push(...outcome.detail);
        await sleep(step.settle ?? 600);
        captured.push(...await inPage(tab.id, () => (window.__coincellCapture ?? []).map(({ method, url, status, body, sent }) => ({ method, url, status, body, sent: sent?.body }))));
        continue;
      }
      if (step.here) await chrome.tabs.reload(tab.id);   // stay on the page the tab is on; just load it afresh
      else await chrome.tabs.update(tab.id, { url: origin + step.go });
      if (step.reload) await chrome.tabs.reload(tab.id);   // a change after the # alone does not load the page afresh
      const patterns = step.waitFor.map((r) => r.source), deadline = Date.now() + (step.timeout ?? 40_000);
      let onLoginPage = 0, timedOut = false;
      for (;;) {
        await sleep(400);
        const now = await chrome.tabs.get(tab.id);
        // A sign-in page that the tab only passes through on its way back in does not count:
        // it has to still be there after a few seconds.
        onLoginPage = now.status === 'complete' && plan.loggedOut?.test(new URL(now.url).pathname + new URL(now.url).hash) ? onLoginPage + 1 : 0;
        if (onLoginPage >= 10) throw new Error(LOGIN_FIRST);
        const have = await inPage(tab.id, (ps) => ps.map((p) => (window.__coincellCapture ?? []).some((e) => new RegExp(p).test(e.url) && e.status < 400)), [patterns]).catch(() => null);
        if (have?.every(Boolean)) break;   // null while the page is still loading
        if (Date.now() > deadline) {
          if (step.optional) { timedOut = true; break; }   // one account's page not loading should not lose the rest
          throw new Error(`${site.name} did not load its data${step.go ? ` on ${step.go}` : ''}. Is the page showing an error or a prompt?`);
        }
      }
      if (timedOut) { log.steps.push('  (that page did not load its data; skipped)'); captured.push(...await inPage(tab.id, () => (window.__coincellCapture ?? []).map(({ method, url, status, body, sent }) => ({ method, url, status, body, sent: sent?.body }))).catch(() => [])); continue; }
      if (step.alsoWait) {   // feeds that are welcome but not required: give them a few more seconds
        const extra = step.alsoWait.map((r) => r.source), until = Date.now() + 12_000;
        while (Date.now() < until) {
          const have = await inPage(tab.id, (ps) => ps.every((p) => (window.__coincellCapture ?? []).some((e) => new RegExp(p).test(e.url))), [extra]).catch(() => false);
          if (have) break;
          await sleep(400);
        }
      }
      if (step.act) { const outcome = await inPage(tab.id, step.act, [shared]); if (outcome?.error) throw new Error(outcome.error); if (outcome && typeof outcome === 'object') Object.assign(shared, outcome); if (outcome?.detail) (log.asked ??= []).push(...outcome.detail); }
      await sleep(step.settle ?? 600);
      captured.push(...await inPage(tab.id, () => (window.__coincellCapture ?? []).map(({ method, url, status, body, sent }) => ({ method, url, status, body, sent: sent?.body }))));
      if (step.expand) queue.unshift(...step.expand(shared));
    }
    // While a site script is still being worked out, save the SHAPE of the feeds it names:
    // field names and types with every value removed, as the recorder does.
    for (const c of captured) {
      if (plan.describe?.some((r) => r.test(c.url))) await post(TARGETS[site.target], '/api/recordings', { host: new URL(c.url).hostname, entry: { kind: 'data', method: c.method, url: c.url.replace(/\?.*/, ''), status: c.status, shape: shapeOf(c.body) } }).catch(() => {});
    }
    return plan.build(captured);
  } finally {
    await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  }
}

// A record of each send, for working out what went wrong without anyone having to read the popup
// aloud: which pages were visited, which of the site's services answered and how, and the outcome.
// Addresses only, with numbers and long codes removed; nothing that was sent or received.
function sendRecord(site, log, ok, message) {
  const tally = new Map();
  for (const c of log.captured) {
    let where = c.url;
    try { const u = new URL(c.url); where = u.pathname.replace(/[A-Za-z0-9_-]{24,}/g, ':token').replace(/\d{4,}/g, '#'); } catch { /* keep as is */ }
    const key = `${c.method} ${where} ${c.status}${c.body == null ? ' (no data)' : ''}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return { kind: 'send', at: new Date().toISOString(), site: site.id, extension: chrome.runtime.getManifest().version, ok, message, steps: log.steps, detail: log.detail, asked: log.asked, warnings: log.warnings,
    answers: [...tally].map(([what, times]) => `${times}x ${what}`).filter((line) => !/analytics|clix|content|offers|insight|marketing|notification|news|logo|quote|flags|audit/i.test(line)).slice(0, 150) };
}

async function sendSite(tab) {
  const site = siteFor(tab.url);
  if (!site) return { ok: false, name: new URL(tab.url).hostname, message: 'coincell does not know this site yet.' };
  const log = { steps: [], captured: [] };
  let result;
  try {
    const { note, detail, ...snapshot } = await (site.capture ? readByCapture(tab, site, log) : readDirect(tab, site));
    log.detail = detail;
    const out = await post(TARGETS[site.target], '/api/import', { bank: site.id, snapshot });
    result = { ok: true, name: site.name, message: `${out.accounts} account${out.accounts === 1 ? '' : 's'} sent${note ? `, ${note}` : ''}`, warnings: out.warnings ?? [] };
    log.warnings = result.warnings;
  } catch (e) {
    result = { ok: false, name: site.name, message: e.message };
  }
  if (site.capture) await post(TARGETS[site.target], '/api/recordings', { host: `${site.id}.sends`, entry: sendRecord(site, log, result.ok, result.message) }).catch(() => {});
  return result;
}

// ---- recording: learn how an unknown site is built, without keeping any of its values ----
const scriptIds = (origin) => { const key = origin.replace(/[^a-z0-9]/gi, '_'); return [`rec_main_${key}`, `rec_relay_${key}`]; };
async function setRecording(tab, on) {
  const origin = new URL(tab.url).origin, [mainId, relayId] = scriptIds(origin);
  const { recording = {} } = await chrome.storage.local.get('recording');
  await chrome.scripting.unregisterContentScripts({ ids: [mainId, relayId] }).catch(() => {});
  if (on) {
    await chrome.scripting.registerContentScripts([
      { id: mainId, matches: [`${origin}/*`], js: ['record-main.js'], world: 'MAIN', runAt: 'document_start' },
      { id: relayId, matches: [`${origin}/*`], js: ['record-relay.js'], runAt: 'document_start' },
    ]);
    // Start on the page that is already open too, so nothing needs reloading.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['record-relay.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['record-main.js'], world: 'MAIN' });
    recording[origin] = true;
  } else delete recording[origin];
  await chrome.storage.local.set({ recording });
  return { ok: true, recording: Boolean(on) };
}

// ---- the bridge: the dashboard asks, this does it ----
// The extension keeps a request open to each coincell it can reach; a command is the answer.
// "Refresh" means: open the site (in a background tab, so the tab you are using is left alone),
// read it if you are logged in, and say so if you are not.
const busy = new Set();
const say = (site, state, message, warnings) => post(TARGETS[site.target], '/ext/progress', { site: site.id, state, message, warnings }).catch(() => {});
const settled = async (tabId, ms = 30_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { if ((await chrome.tabs.get(tabId)).status === 'complete') break; } await sleep(2500); return chrome.tabs.get(tabId); };

// Pages often do nothing while their tab is in the background. So the tabs this extension opens go
// in a window of their own, where each is the tab in view, and your own windows are left as they are.
async function openWork(url) {
  const { workWindow } = await chrome.storage.session.get('workWindow');
  if (workWindow != null) {
    try { await chrome.windows.get(workWindow); return await chrome.tabs.create({ windowId: workWindow, url, active: true }); } catch { /* that window was closed */ }
  }
  const win = await chrome.windows.create({ url, focused: false });
  await chrome.storage.session.set({ workWindow: win.id });
  return win.tabs[0];
}

async function refreshOne(site) {
  const key = `${site.target}:${site.id}`;
  if (busy.has(key)) return;
  busy.add(key);
  // A site waiting for a login must be read the moment you are in, however recently it was last read.
  const awaitLogin = async (message) => { const { cool = {} } = await chrome.storage.session.get('cool'); delete cool[key]; await chrome.storage.session.set({ cool }); await say(site, 'needs-login', message); };
  try {
    await say(site, 'working', 'Opening the site');
    let tab = site.ownTab || !site.home ? (await chrome.tabs.query({})).find((t) => site.loggedIn.test(t.url ?? '')) : null, opened = false;
    if (!tab) {
      if (!site.home) return void await awaitLogin('Open this site and log in');
      // A login tab this extension opened on an earlier attempt is replaced, not piled on.
      // Tabs you opened yourself are never closed.
      const { mine = {} } = await chrome.storage.session.get('mine');
      if (mine[key] != null) await chrome.tabs.remove(mine[key]).catch(() => {});
      tab = await settled((await openWork(site.home)).id);
      opened = true;
      await chrome.storage.session.set({ mine: { ...mine, [key]: site.loggedIn.test(tab.url ?? '') ? undefined : tab.id } });
    }
    if (!site.loggedIn.test(tab.url ?? '')) {
      // With a login saved in coincell, sign in with it (see signin.js); otherwise it is yours to do.
      const signed = await signIn(site, tab, (message) => say(site, 'working', message));
      if (!signed.ok) return void await awaitLogin(signed.message ?? (opened ? 'Log in to this site in the tab that was opened; it will be read as soon as you are in' : 'Log in to this site'));
      tab = await settled(tab.id);
    }
    await say(site, 'working', 'Reading');
    const r = await sendSite(tab);
    if (r.ok) {
      await say(site, 'done', r.message, r.warnings);
      const { cool = {} } = await chrome.storage.session.get('cool');   // read; no need to read it again for a while
      await chrome.storage.session.set({ cool: { ...cool, [key]: Date.now() } });
      if (opened && !site.ownTab) await chrome.tabs.remove(tab.id).catch(() => {});
    } else if (/not logged in/i.test(r.message)) await awaitLogin(r.message);
    else await say(site, 'failed', r.message);
  } catch (e) {
    await say(site, 'failed', e.message);
  } finally {
    busy.delete(key);
  }
}

const polling = new Set();
async function listen(name) {
  if (polling.has(name)) return;
  polling.add(name);
  const ids = [...new Set(SITES.filter((s) => s.target === name && s.loggedIn).map((s) => s.id))];
  try {
    for (;;) {
      const canSignIn = [...new Set(SITES.filter((s) => s.target === name && s.signIn).map((s) => s.id))];
      const res = await fetch(`${TARGETS[name]}/ext/poll?sites=${ids.join(',')}&signin=${canSignIn.join(',')}&v=${chrome.runtime.getManifest().version}`, { headers: { 'x-coincell': '1' } }).catch(() => null);
      if (!res?.ok) break;   // coincell is not running there; the alarm below tries again
      const cmd = await res.json().catch(() => ({}));
      if (cmd.type === 'refresh') (async () => { for (const id of cmd.sites) { const site = SITES.find((s) => s.id === id && s.target === name && s.loggedIn); if (site) await refreshOne(site); } })();
    }
  } finally {
    polling.delete(name);
  }
}
const listenAll = () => { for (const name of Object.keys(TARGETS)) listen(name); };
chrome.alarms.create('listen', { periodInMinutes: 0.5 });   // the browser puts idle extensions to sleep; this wakes it to listen again
chrome.alarms.onAlarm.addListener(listenAll);
chrome.runtime.onStartup.addListener(listenAll);
chrome.runtime.onInstalled.addListener(listenAll);
listenAll();

// Sync when you log in: landing on a site's logged-in pages is the cue to read it, unless it was
// read in the last 15 minutes or you have switched this off in the popup.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const site = SITES.find((s) => s.loggedIn?.test(tab.url ?? ''));
  if (!site) return;
  const key = `${site.target}:${site.id}`;
  const { rejected = {} } = await chrome.storage.local.get('rejected');   // you are in, so whatever was thought of the saved login is out of date
  if (rejected[key]) { delete rejected[key]; await chrome.storage.local.set({ rejected }); }
  const [{ autoSync = true }, { cool = {} }] = await Promise.all([chrome.storage.local.get('autoSync'), chrome.storage.session.get('cool')]);
  if (!autoSync || busy.has(key) || Date.now() - (cool[key] ?? 0) < 15 * 60_000) return;
  refreshOne(site);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'send') return [await sendSite(await chrome.tabs.get(msg.tabId))];
    if (msg.type === 'send-all') {
      const tabs = (await chrome.tabs.query({})).filter((t) => siteFor(t.url));
      const seen = new Set(), results = [];
      for (const t of tabs) { const id = siteFor(t.url).id; if (!seen.has(id)) { seen.add(id); results.push(await sendSite(t)); } }
      return results;
    }
    if (msg.type === 'record') return setRecording(await chrome.tabs.get(msg.tabId), msg.on);
    if (msg.type === 'rec-entry' && sender.tab) {   // from record-relay.js
      const url = sender.tab.url;
      await post(targetFor(url), '/api/recordings', { host: new URL(url).hostname, entry: msg.entry }).catch(() => {});
      return { ok: true };
    }
    return null;
  })().then(reply, (e) => reply([{ ok: false, name: 'coincell', message: e.message }]));
  return true; // the reply comes later
});
