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

const shapeOf = (v, depth = 0) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `(${v.length} items)`] : [];
  if (typeof v === 'object') return depth > 9 ? '{...}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/[0-9]{4,}/g, '#'), shapeOf(x, depth + 1)]));
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
async function readByCapture(tab, site) {
  const origin = new URL(tab.url).origin, id = `capture_${site.id}`, plan = site.capture;
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: ['capture-main.js'], world: 'MAIN', runAt: 'document_start' }]);
  try {
    const captured = [];
    for (const step of plan.steps) {
      await chrome.tabs.update(tab.id, { url: origin + step.go });
      const patterns = step.waitFor.map((r) => r.source), deadline = Date.now() + (step.timeout ?? 40_000);
      for (;;) {
        await sleep(400);
        const now = await chrome.tabs.get(tab.id);
        if (now.status === 'complete' && plan.loggedOut?.test(new URL(now.url).pathname)) throw new Error(LOGIN_FIRST);
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
      if (step.act) await inPage(tab.id, step.act);
      await sleep(step.settle ?? 600);
      captured.push(...await inPage(tab.id, () => (window.__coincellCapture ?? []).map(({ method, url, status, body }) => ({ method, url, status, body }))));
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

async function sendSite(tab) {
  const site = siteFor(tab.url);
  if (!site) return { ok: false, name: new URL(tab.url).hostname, message: 'coincell does not know this site yet.' };
  try {
    const { note, ...snapshot } = await (site.capture ? readByCapture(tab, site) : readDirect(tab, site));
    const out = await post(TARGETS[site.target], '/api/import', { bank: site.id, snapshot });
    return { ok: true, name: site.name, message: `${out.accounts} account${out.accounts === 1 ? '' : 's'} sent${note ? `, ${note}` : ''}` };
  } catch (e) {
    return { ok: false, name: site.name, message: e.message };
  }
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
