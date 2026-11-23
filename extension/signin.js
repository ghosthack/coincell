// Signing in with a login you saved in coincell, for a site whose session has run out.
//
// What this does, and where its limits are:
//   - The login comes from coincell on this computer (which keeps it in the macOS Keychain) and is
//     handed straight to the site's own sign-in page. It is never kept in the extension.
//   - It is only ever filled in on addresses listed as that site's sign-in pages in sites.js.
//   - A login the site turns down is not tried again until you save it anew, so a wrong password
//     cannot lock your account.
//   - A code the site emails is read from the inbox you named, from that site's sender only.
//   - Anything else a site asks (a text message, an app prompt, a puzzle) is left to you: the tab
//     stays open and the site is read as soon as you are in.
// Fields are set the plain way, then the page is told about it. Nothing here pretends to be a
// person or hides that a program is filling in the form.
import { TARGETS } from './sites.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the sign-in page. `look` says what the page is asking for; the others answer it.
function onPage(step, data) {
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly; };
  const words = (i) => [i.name, i.id, i.placeholder, i.autocomplete, i.getAttribute('aria-label'), i.labels?.[0]?.textContent].join(' ');
  const shown2 = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const plain = inputs.filter((i) => ['text', 'email', 'tel', 'number'].includes(i.type));
  const pass = inputs.find((i) => i.type === 'password' && i.autocomplete !== 'one-time-code');
  const code = pass ? null : inputs.find((i) => i.autocomplete === 'one-time-code') ?? plain.find((i) => /otp|verif|security.?code|one.?time|\bcode\b/i.test(words(i)));
  const user = pass ? plain.filter((i) => pass.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING).at(-1)
    : !code && plain.length === 1 && /user|login|e-?mail|\bid\b/i.test(words(plain[0])) ? plain[0] : null;
  const buttons = (root) => [...root.querySelectorAll('button, input[type=submit], [role=button]')].filter(shown);
  const label = (b) => (b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
  const remember = pass || code || user ? null : buttons(document).find((b) => /remember (this|my) (device|computer|browser)|trust this (device|computer|browser)/i.test(label(b)));

  // The layout of the page, for working out why a sign-in went wrong: headings, and the labels of
  // fields and buttons. No field values; digits and anything shaped like an email address are masked.
  if (step === 'outline') {
    const mask = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/[^\s@]+@[^\s@]+/g, 'x@x').replace(/\d/g, '9').slice(0, 90);
    return {
      path: location.pathname.replace(/\d/g, '9').slice(0, 80), frames: document.querySelectorAll('iframe').length,
      headings: [...document.querySelectorAll('h1, h2, h3, legend, [role=heading]')].filter(shown2).slice(0, 8).map((h) => mask(h.textContent)),
      fields: [...document.querySelectorAll('input, select, textarea')].filter((i) => i.type !== 'hidden').slice(0, 20).map((i) => ({ type: i.type, name: mask(i.name), id: mask(i.id), autocomplete: i.autocomplete || undefined,
        label: mask(i.labels?.[0]?.textContent || i.getAttribute('aria-label') || i.placeholder), shown: shown(i), checked: i.type === 'radio' || i.type === 'checkbox' ? i.checked : undefined })),
      buttons: buttons(document).slice(0, 15).map((b) => mask(label(b))),
      links: [...document.querySelectorAll('a')].filter(shown2).slice(0, 15).map((a) => mask(a.textContent)).filter(Boolean),
    };
  }
  if (step === 'look') return { has: pass ? 'password' : code ? 'code' : user ? 'user' : remember ? 'remember' : 'none' };

  const told = (el, inputType, text) => el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: text ?? null }));
  // In a tab you are not looking at, the browser holds back the "focus" notice, so the page is told directly.
  const enter = (el) => { let noticed = false; const on = () => { noticed = true; }; el.addEventListener('focus', on, { once: true }); el.focus(); el.removeEventListener('focus', on);
    if (!noticed) { el.dispatchEvent(new FocusEvent('focus')); el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } };
  const key = (el, type, k) => el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: k, code: k === 'a' ? 'KeyA' : k }));
  const put = (el, value) => { enter(el); el.value = value; told(el, 'insertText', value); el.dispatchEvent(new Event('change', { bubbles: true })); };
  // Some carelessly built pages only count a field as filled once it has been edited, or once a
  // key was pressed in it. So after the password is in place, one letter is added to its end and
  // taken away again, and the page is told of both key presses.
  const nudge = (el) => {
    const value = el.value;
    key(el, 'keydown', 'a'); el.value = `${value}a`; told(el, 'insertText', 'a'); key(el, 'keyup', 'a');
    key(el, 'keydown', 'Backspace'); el.value = value; told(el, 'deleteContentBackward'); key(el, 'keyup', 'Backspace');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const send = (el) => {
    el.blur();
    const inForm = el.form ? buttons(el.form).filter((b) => b.type === 'submit') : [];
    const named = buttons(el.form ?? document).find((b) => /^(sign|log) ?(in|on)|^continue|^next|^submit|^verify|^confirm/i.test(label(b)));
    const button = inForm[0] ?? named;
    if (button) button.click(); else el.form?.requestSubmit();
  };
  if (step === 'user' && user) { put(user, data.username); send(user); }
  if (step === 'password' && pass) {
    if (user && user.value !== data.username) put(user, data.username);
    put(pass, data.password); if (data.nudge) nudge(pass); send(pass);
  }
  if (step === 'code' && code) {
    // "Remember this device", where offered, means fewer codes later.
    for (const box of document.querySelectorAll('input[type=checkbox]')) if (shown(box) && !box.checked && /remember|trust|don.?t ask/i.test(words(box))) box.click();
    put(code, data.code); send(code);
  }
  if (step === 'remember' && remember) remember.click();
  return { done: true };
}

// ---- the emailed code ----
// Gmail offers a feed of the unread mail in an inbox you are signed in to. Only that feed is
// read, only mail from the site's own sender is looked at, and nothing from it is kept or passed on.
const okFeed = (u) => /^https:\/\/mail\.google\.com\/mail\/u\/\d\/feed\/atom$/.test(u) || u === 'http://localhost:4706/mail/u/0/feed/atom';
const unxml = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const part = (xml, tag) => unxml(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? '');

async function readInbox(inbox) {
  for (const url of inbox.feeds.filter(okFeed)) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' }).catch(() => null);
    if (!res?.ok) continue;
    const xml = await res.text();
    if (!part(xml, 'title').toLowerCase().includes(inbox.address.toLowerCase())) continue;   // another account's inbox
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({ from: part(e, 'email').toLowerCase(), at: Date.parse(part(e, 'issued')), text: `${part(e, 'title')} ${part(e, 'summary')}` }));
  }
  return null;
}

// A code can come two ways: by email, which is read from the inbox, or typed by you on the coincell
// dashboard (for one texted to your phone). Both are watched until one turns up.
async function awaitCode(site, inbox, since) {
  const base = TARGETS[site.target];
  let inboxOk = true;
  for (const end = Date.now() + 5 * 60_000, start = Date.now(); Date.now() < end; await sleep(3000)) {
    const typed = await fetch(`${base}/ext/code?site=${site.id}`, { headers: { 'x-coincell': '1' } }).then((r) => r.json()).catch(() => ({}));
    if (typed.code) return { code: typed.code };
    if (!site.code || !inbox) continue;
    const mail = await readInbox(inbox);
    inboxOk = Boolean(mail);
    const found = (mail ?? []).filter((m) => site.code.from.test(m.from) && m.at >= since - 15_000).sort((x, y) => y.at - x.at)
      .map((m) => (site.code.pattern ?? /\b\d{6,8}\b/).exec(m.text)?.[0]).find(Boolean);
    if (found) return { code: found };
  }
  return { message: `The site asked for a code, and none was emailed${inboxOk ? '' : ' (the Gmail inbox could not be read)'} or typed in within five minutes. Enter it on the site yourself.` };
}

const UNKNOWN = 'The site is asking something coincell cannot answer. Finish logging in yourself; it will be read as soon as you are in.';

/** Try to get `tab` from the site's sign-in page to its logged-in pages. Returns { ok } or { ok: false, message }. */
export async function signIn(site, tab, say) {
  if (!site.signIn) return { ok: false };
  const key = `${site.target}:${site.id}`;
  const login = await fetch(`${TARGETS[site.target]}/ext/login?site=${site.id}`, { headers: { 'x-coincell': '1' } }).then((r) => r.json()).catch(() => ({}));
  if (!login.username) return { ok: false, message: login.error };   // no saved login: you log in, as before
  // plainFill is a switch for the tests only: it leaves out the add-and-remove step, to show the careless fake sites do refuse without it.
  const { rejected = {}, plainFill = false } = await chrome.storage.local.get(['rejected', 'plainFill']);
  // The mark names the login and the extension version that failed with it: a newer login or a newer extension gets a fresh try.
  const mark = `${login.savedAt} by ${chrome.runtime.getManifest().version}`;
  if (rejected[key] === mark) return { ok: false, message: 'The saved login was not accepted last time, so it was not tried again. Log in yourself, or save the login again.' };

  const run = (step, data = {}) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: onPage, args: [step, data] });
  const look = async () => { try { return (await run('look'))[0]?.result?.has ?? 'none'; } catch (e) { return /cannot access|permission/i.test(e.message) ? 'blocked' : 'none'; } };
  // A sign-in page may wait until it is actually on screen, so its tab and window are brought to the front.
  const front = async () => { await chrome.tabs.update(tab.id, { active: true }).catch(() => {}); await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {}); await sleep(500); };
  // What each page of the sign-in looked like goes to coincell's recordings folder on this computer (layout only).
  let lastNoted = '';
  const note = async (has) => {
    if (has === lastNoted) return; lastNoted = has;
    const outline = await run('outline').then((r) => r[0]?.result).catch(() => null);
    if (outline) await fetch(`${TARGETS[site.target]}/api/recordings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' },
      body: JSON.stringify({ host: `${site.id}.signin`, entry: { kind: 'signin', at: new Date().toISOString(), version: chrome.runtime.getManifest().version, has, outline } }) }).catch(() => {});
  };
  const acted = new Set();
  let since = Date.now(), quiet = 0, shown = false;
  for (const end = Date.now() + 4 * 60_000; Date.now() < end;) {
    const now = await chrome.tabs.get(tab.id);
    if (site.loggedIn.test(now.url ?? '')) {
      if (rejected[key]) { delete rejected[key]; await chrome.storage.local.set({ rejected }); }
      return { ok: true };
    }
    const has = now.status === 'complete' ? (site.signIn.test(now.url ?? '') ? await look() : 'elsewhere') : 'none';
    if (has === 'blocked') return { ok: false, message: 'Chrome has not been told this extension may fill in this site. Press "Allow sign-in help" in the extension\'s popup.' };
    if (has === 'none' || has === 'elsewhere') {   // still loading, on its way somewhere, or a page with nothing to fill in
      if (quiet === 12 && now.status === 'complete') await note(`${has} (nothing to fill in)`);
      if (++quiet > 20) return { ok: false, message: has === 'elsewhere' ? `Its sign-in page is at ${new URL(now.url).hostname}${new URL(now.url).pathname.slice(0, 60)}, which coincell does not fill in. Log in yourself; it will be read as soon as you are in.` : UNKNOWN };
      await sleep(700); continue;
    }
    quiet = 0;
    await note(has);
    if (acted.has(has)) {   // answered this already, and the site is asking again
      if (has === 'password') { await chrome.storage.local.set({ rejected: { ...rejected, [key]: mark } }); return { ok: false, message: 'The site did not let the saved login through. It will not be tried again until you save it anew, or log in yourself.' }; }
      return { ok: false, message: has === 'code' ? 'The site did not accept the emailed code. Enter it yourself.' : UNKNOWN };
    }
    if (!shown) { await front(); shown = true; }
    if (has === 'user') { await say('Signing in'); await run('user', { username: login.username }); }
    if (has === 'password') { await say('Signing in'); since = Date.now(); await run('password', { username: login.username, password: login.password, nudge: !plainFill }); }
    if (has === 'code') {
      await say('The site asks for a code. An emailed one is entered by itself; type a texted one here.', 'needs-code');
      const got = await awaitCode(site, login.inbox, since);
      if (!got.code) return { ok: false, message: got.message };
      await say('Entering the code');
      await run('code', { code: got.code });
    }
    if (has === 'remember') await run('remember');
    acted.add(has);
    // Give the site time to move on: until it shows something else, for up to 20 seconds.
    for (const until = Date.now() + 20_000; Date.now() < until; await sleep(600)) {
      const t = await chrome.tabs.get(tab.id);
      if (site.loggedIn.test(t.url ?? '') || (t.status === 'complete' && (await look()) !== has)) break;
    }
  }
  return { ok: false, message: UNKNOWN };
}
