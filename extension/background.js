// Runs the site scripts in your tabs and hands what they collect to coincell on this computer.
import { SITES, TARGETS, siteFor, targetFor } from './sites.js';

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
    for (const step of plan.steps) {
      log.steps.push(step.live ? 'live page' : step.go);
      if (step.live) {   // no loading of pages: start capturing on the page as it is, and let the step drive it
        if (plan.loggedOut?.test(new URL(tab.url).pathname + new URL(tab.url).hash)) throw new Error(LOGIN_FIRST);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture-main.js'], world: 'MAIN' });
        const outcome = await inPage(tab.id, step.act, [shared]);
        if (outcome?.error) throw new Error(outcome.error);
        if (outcome && typeof outcome === 'object') Object.assign(shared, outcome);
        await sleep(step.settle ?? 600);
        captured.push(...await inPage(tab.id, () => (window.__coincellCapture ?? []).map(({ method, url, status, body, sent }) => ({ method, url, status, body, sent: sent?.body }))));
        continue;
      }
      await chrome.tabs.update(tab.id, { url: origin + step.go });
      if (step.reload) await chrome.tabs.reload(tab.id);   // a change after the # alone does not load the page afresh
      const patterns = step.waitFor.map((r) => r.source), deadline = Date.now() + (step.timeout ?? 40_000);
      for (;;) {
        await sleep(400);
        const now = await chrome.tabs.get(tab.id);
        if (now.status === 'complete' && plan.loggedOut?.test(new URL(now.url).pathname + new URL(now.url).hash)) throw new Error(LOGIN_FIRST);
        const have = await inPage(tab.id, (ps) => ps.map((p) => (window.__coincellCapture ?? []).some((e) => new RegExp(p).test(e.url) && e.status < 400)), [patterns]).catch(() => null);
        if (have?.every(Boolean)) break;   // null while the page is still loading
        if (Date.now() > deadline) throw new Error(`${site.name} did not load its data on ${step.go}. Is the page showing an error or a prompt?`);
      }
      if (step.alsoWait) {   // feeds that are welcome but not required: give them a few more seconds
        const extra = step.alsoWait.map((r) => r.source), until = Date.now() + 12_000;
        while (Date.now() < until) {
          const have = await inPage(tab.id, (ps) => ps.every((p) => (window.__coincellCapture ?? []).some((e) => new RegExp(p).test(e.url))), [extra]).catch(() => false);
          if (have) break;
          await sleep(400);
        }
      }
      if (step.act) { const outcome = await inPage(tab.id, step.act, [shared]); if (outcome && typeof outcome === 'object') Object.assign(shared, outcome); }
      await sleep(step.settle ?? 600);
      captured.push(...await inPage(tab.id, () => (window.__coincellCapture ?? []).map(({ method, url, status, body, sent }) => ({ method, url, status, body, sent: sent?.body }))));
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
  return { kind: 'send', at: new Date().toISOString(), site: site.id, extension: chrome.runtime.getManifest().version, ok, message, steps: log.steps,
    answers: [...tally].map(([what, times]) => `${times}x ${what}`).filter((line) => !/analytics|clix|content|offers|insight|marketing|notification|news|logo|quote|flags|audit/i.test(line)).slice(0, 150) };
}

async function sendSite(tab) {
  const site = siteFor(tab.url);
  if (!site) return { ok: false, name: new URL(tab.url).hostname, message: 'coincell does not know this site yet.' };
  const log = { steps: [], captured: [] };
  let result;
  try {
    const { note, ...snapshot } = await (site.capture ? readByCapture(tab, site, log) : readDirect(tab, site));
    const out = await post(TARGETS[site.target], '/api/import', { bank: site.id, snapshot });
    result = { ok: true, name: site.name, message: `${out.accounts} account${out.accounts === 1 ? '' : 's'} sent${note ? `, ${note}` : ''}` };
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
