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

async function sendSite(tab) {
  const site = siteFor(tab.url);
  if (!site) return { ok: false, name: new URL(tab.url).hostname, message: 'coincell does not know this site yet.' };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib.js', site.file] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id },
      func: async () => { try { return { snapshot: await globalThis.__coincellSite() }; } catch (e) { return { error: e.message }; } } });
    if (result.error) throw new Error(result.error);
    const out = await post(TARGETS[site.target], '/api/import', { bank: site.id, snapshot: result.snapshot });
    return { ok: true, name: site.name, message: `${out.accounts} account${out.accounts === 1 ? '' : 's'} sent` };
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
