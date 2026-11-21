import { siteFor } from './sites.js';

const $ = (id) => document.getElementById(id);
// Normally the popup acts on the tab you are looking at; ?tab=<id> lets a test point it at one.
const wanted = Number(new URLSearchParams(location.search).get('tab'));
const tab = wanted ? await chrome.tabs.get(wanted) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const isWeb = /^https?:/.test(tab?.url ?? '');
const site = siteFor(tab?.url);
const origin = isWeb ? new URL(tab.url).origin : null;

$('site').textContent = site ? site.name : isWeb ? new URL(tab.url).hostname : 'No website in this tab';
$('hint').textContent = site ? 'Log in to the site first if you have not.' : isWeb ? 'coincell does not know this site yet. Record it so a script can be written.' : '';
$('send').disabled = !site;
$('record').disabled = !isWeb;

function show(results) {
  $('results').replaceChildren(...results.map((r) => {
    const row = document.createElement('div'); row.className = 'result';
    const mark = document.createElement('b'); mark.textContent = r.ok ? '✓' : '✕';
    const name = document.createElement('b'); name.textContent = r.name;
    const msg = document.createElement('span'); msg.textContent = r.message;
    row.append(mark, name, msg); return row;
  }));
  if (!results.length) $('results').textContent = 'No open tab is on a site coincell knows.';
}
async function run(button, message) {
  button.disabled = true; $('results').textContent = 'Working…';
  try { show(await chrome.runtime.sendMessage(message)); } finally { button.disabled = false; }
}
$('send').addEventListener('click', () => run($('send'), { type: 'send', tabId: tab.id }));
$('send-all').addEventListener('click', () => run($('send-all'), { type: 'send-all' }));

let recording = Boolean(origin && ((await chrome.storage.local.get('recording')).recording ?? {})[origin]);
const paint = () => {
  $('record').textContent = recording ? 'Stop recording' : 'Start recording this site';
  if (recording) $('record-hint').textContent = 'Recording. Open your accounts, positions and activity pages, then stop. Values are never kept.';
};
paint();
$('record').addEventListener('click', async () => {
  if (!recording && !(await chrome.permissions.request({ origins: [`${origin}/*`] }))) return;   // Chrome asks you to allow this one site
  const out = await chrome.runtime.sendMessage({ type: 'record', tabId: tab.id, on: !recording });
  if (out?.ok) { recording = out.recording; paint(); }
});
