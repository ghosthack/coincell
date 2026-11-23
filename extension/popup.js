import { SITES, TARGETS, siteFor } from './sites.js';

const $ = (id) => document.getElementById(id);
$('version').textContent = chrome.runtime.getManifest().version;
// A row's label: its details show as a tooltip on hover, and open underneath on a click.
for (const b of document.querySelectorAll('button.label')) {
  const detail = $(b.dataset.for);
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('mouseenter', () => { b.title = detail.textContent; });
  b.addEventListener('click', () => { detail.hidden = !detail.hidden; b.setAttribute('aria-expanded', String(!detail.hidden)); });
}
$('auto-sync').checked = (await chrome.storage.local.get('autoSync')).autoSync ?? true;
$('auto-sync').addEventListener('change', (e) => chrome.storage.local.set({ autoSync: e.target.checked }));
// Normally the popup acts on the tab you are looking at; ?tab=<id> lets a test point it at one.
const wanted = Number(new URLSearchParams(location.search).get('tab'));
const tab = wanted ? await chrome.tabs.get(wanted) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const isWeb = /^https?:/.test(tab?.url ?? '');
const site = siteFor(tab?.url);
const origin = isWeb ? new URL(tab.url).origin : null;

const dashboard = isWeb && Object.values(TARGETS).includes(new URL(tab.url).origin);   // the tab is coincell itself, not a bank
$('site').textContent = site ? `This tab: ${site.name}` : dashboard ? 'This tab: coincell itself' : isWeb ? `${new URL(tab.url).hostname}: not supported yet` : 'No website in this tab';
$('hint').textContent = site ? (site.capture ? 'Log in first. This tab will move through the pages it needs by itself.' : 'Log in to the site first if you have not.') : dashboard ? 'This is the coincell dashboard. Open one of your banks in a tab to send it.' : isWeb ? 'coincell cannot read this site yet. Record it with the site recorder so that support can be added.' : '';
$('send').disabled = !site;


function show(results) {
  $('results').replaceChildren(...results.map((r) => {
    const row = document.createElement('div'); row.className = 'result';
    const mark = document.createElement('b'); mark.textContent = r.ok ? '✓' : '✕';
    const name = document.createElement('b'); name.textContent = r.name;
    const msg = document.createElement('span'); msg.textContent = r.message;
    row.append(mark, name, msg);
    for (const w of r.warnings ?? []) { const warn = document.createElement('span'); warn.className = 'warn'; warn.textContent = `⚠ ${w}`; row.append(warn); }   // less than last time: the site may have changed
    return row;
  }));
  if (!results.length) $('results').textContent = 'No open tab is on a site coincell knows.';
}
async function run(button, message) {
  button.disabled = true; $('results').textContent = 'Working…';
  try { show(await chrome.runtime.sendMessage(message)); } finally { button.disabled = false; }
}
$('send').addEventListener('click', async () => {
  // A site outside this computer needs your say-so once; Chrome shows the prompt.
  if (!origin.startsWith('http://localhost') && !(await chrome.permissions.request({ origins: [`${origin}/*`] }))) return;
  run($('send'), { type: 'send', tabId: tab.id });
});
$('send-all').addEventListener('click', () => run($('send-all'), { type: 'send-all' }));

// Signing in with saved logins needs Chrome's leave for each site's sign-in pages, and for Gmail's feed of unread mail.
const needed = [...new Set([...SITES.filter((s) => s.target === 'real' && s.signIn).flatMap((s) => [...(s.home ? [`${new URL(s.home).origin}/*`] : []), ...(s.allow ?? [])]), 'https://mail.google.com/*'])];
const paintAllow = async () => { if (await chrome.permissions.contains({ origins: needed })) { $('allow').disabled = true; $('allow').textContent = 'Allowed ✓'; } };
paintAllow();
$('allow').addEventListener('click', async () => { await chrome.permissions.request({ origins: needed }); paintAllow(); });

// The site recorder: Rec starts it, Pause stops it for now; Rec again carries on in the same recording.
let recording = Boolean(origin && ((await chrome.storage.local.get('recording')).recording ?? {})[origin]);
const HOW = $('record-hint').textContent;
const paint = () => {
  $('record').setAttribute('aria-pressed', String(recording));
  $('record').disabled = !isWeb || recording;   // already recording: nothing to start
  $('pause').disabled = !recording;             // nothing to pause unless it is recording
  $('record-hint').textContent = recording ? 'Recording. Open your accounts, positions and activity pages, then pause. Values are never kept.' : HOW;
  if (recording) $('record-hint').hidden = false;
};
paint();
const setRecording = async (on) => {
  if (on && !(await chrome.permissions.request({ origins: [`${origin}/*`] }))) return;   // Chrome asks you to allow this one site
  const out = await chrome.runtime.sendMessage({ type: 'record', tabId: tab.id, on });
  if (out?.ok) { recording = out.recording; paint(); }
};
$('record').addEventListener('click', () => setRecording(true));
$('pause').addEventListener('click', () => setRecording(false));
