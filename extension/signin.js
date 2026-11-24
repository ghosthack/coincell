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
import { SITES, TARGETS } from './sites.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the sign-in page. `look` says what the page is asking for; the others answer it.
function onPage(step, data) {
  // Everything on the page that matches, including what sits inside the page's own components (open shadow roots).
  const everything = (() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; })();
  const Q = (selector) => everything.filter((el) => el.matches(selector));
  // A home-made control may answer to the press rather than the click, so it is given both.
  const press = (e) => { for (const type of ['pointerdown', 'mousedown']) e.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); e.focus?.(); for (const type of ['pointerup', 'mouseup']) e.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); e.click(); };
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly; };
  const words = (i) => [i.name, i.id, i.placeholder, i.autocomplete, i.getAttribute('aria-label'), i.labels?.[0]?.textContent].join(' ');
  const shown2 = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };
  const inputs = Q('input').filter(shown);
  const plain = inputs.filter((i) => ['text', 'email', 'tel', 'number'].includes(i.type));
  const pass = inputs.find((i) => i.type === 'password' && i.autocomplete !== 'one-time-code');
  const code = pass ? null : inputs.find((i) => i.autocomplete === 'one-time-code') ?? plain.find((i) => /otp|verif|security.?code|one.?time|\bcode\b/i.test(words(i)));
  const user = pass ? plain.filter((i) => pass.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING).at(-1)
    : !code && plain.length === 1 && /user|login|e-?mail|\bid\b/i.test(words(plain[0])) ? plain[0] : null;
  const buttons = (root) => (root === document ? Q('button, input[type=submit], [role=button]') : [...root.querySelectorAll('button, input[type=submit], [role=button]')]).filter(shown);
  const label = (b) => (b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
  const remember = pass || code || user ? null : buttons(document).find((b) => /remember (this|my) (device|computer|browser)|trust this (device|computer|browser)/i.test(label(b)));

  // The layout of the page, for working out why a sign-in went wrong: headings, and the labels of
  // fields and buttons. No field values; digits and anything shaped like an email address are masked.
  if (step === 'outline') {
    const texts = Q('p, label, li, [role=radio], [role=option]').filter(shown2).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 3 && t.length < 160).slice(0, 14);
    const tagOf = (el) => { const chain = []; for (let n = el; n && chain.length < 4; n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentElement) chain.push(n.tagName?.toLowerCase() + (n.getAttribute?.('role') ? `[role=${n.getAttribute('role')}]` : '')); return chain.join(' < '); };
    const mask = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/[^\s@]+@[^\s@]+/g, 'x@x').replace(/\d/g, '9').slice(0, 90);
    return {
      path: location.pathname.replace(/\d/g, '9').slice(0, 80), frames: document.querySelectorAll('iframe').length,
      headings: Q('h1, h2, h3, legend, [role=heading]').filter(shown2).slice(0, 8).map((h) => mask(h.textContent)),
      fields: Q('input, select, textarea').filter((i) => i.type !== 'hidden').slice(0, 20).map((i) => ({ type: i.type, name: mask(i.name), id: mask(i.id), autocomplete: i.autocomplete || undefined,
        label: mask(i.labels?.[0]?.textContent || i.getAttribute('aria-label') || i.placeholder), shown: shown(i), filled: ['radio', 'checkbox', 'button', 'submit'].includes(i.type) ? undefined : Boolean(i.value), within: i.type === 'radio' ? tagOf(i) : undefined, checked: i.type === 'radio' || i.type === 'checkbox' ? i.checked : undefined })),
      buttons: buttons(document).slice(0, 15).map((b) => mask(label(b))),
      nextButton: (() => { const b = Q('button, [role=button]').find((x) => /^next/i.test(label(x))); return b ? `${tagOf(b)} disabled=${b.disabled} aria-disabled=${b.getAttribute('aria-disabled')} type=${b.type}` : null; })(),
      alerts: Q('[role=alert], .error, [aria-live=assertive]').filter(shown2).map((e) => mask(e.textContent)).filter(Boolean).slice(0, 4),
      links: Q('a').filter(shown2).slice(0, 15).map((a) => mask(a.textContent)).filter(Boolean),
      texts: texts.map(mask),
    };
  }
  // A page offering to send an approval to the site's phone app.
  const push = pass || code || user ? null : buttons(document).find((b) => /^send (a |the )?(push )?notification/i.test(label(b)));
  // A page asking how to reach you for the second step: a set of choices and a button to go on.
  // The order of preference is what needs least of you: an emailed code (coincell reads it), then
  // whatever leads to more choices, then a tap in the site's phone app, then a texted code.
  const options = pass || code || user || push ? [] : Q('input[type=radio]').map((r) => ({ r, face: shown(r) ? r : [...(r.labels ?? [])].find(shown2), text: words(r) })).filter((o) => o.face);
  const KINDS = [['email', /e-?mail|@/i], ['more', /different way|another way|other (way|option|method)/i], ['push', /notification|push|\bapp\b/i], ['text', /\btext\b|sms/i]];
  const choice = options.length >= 2 ? KINDS.filter(([kind]) => kind !== data?.avoid).map(([kind, re]) => ({ kind, o: options.find((o) => re.test(o.text)) })).find((c) => c.o) : null;
  // The same question asked with big cards to press instead of a list ("Text a code via SMS", "Receive a
  // voice call"). At least two ways must be on offer for it to count; a voice call is never chosen.
  const WAYS = [['email', /e-?mail (me )?(a |the )?code|code (via|by) e-?mail/i], ['push', /send (a |the )?(push )?notification/i], ['text', /text (me )?(a |the )?code|via sms|code (via|by) (sms|text)/i], ['voice', /voice call|call me/i]];
  const innermost = (re) => everything.filter((e) => shown2(e) && re.test(e.textContent) && e.textContent.trim().length < 60).filter((e, _, all) => !all.some((o) => o !== e && e.contains(o)))[0];
  const cards = pass || code || user || push || choice ? [] : WAYS.map(([kind, re]) => ({ kind, el: innermost(re) })).filter((c) => c.el);
  const card = cards.length >= 2 ? cards.find((c) => c.kind !== 'voice') : null;
  if (step === 'look') return { has: pass ? 'password' : code ? 'code' : user ? 'user' : push ? 'push' : choice || card ? 'choose' : remember ? 'remember' : 'none', url: location.href,
    sig: choice ? options.map((o) => o.text.replace(/\d/g, '9').slice(0, 30)).join('|') : card ? cards.map((c) => c.kind).join('|') : '' };
  if (step === 'choose' && !choice && card) { tickRemember(); press(card.el.closest('button, a, [role=button], [tabindex], li, label') ?? card.el); return { picked: card.kind, cards: true }; }
  if (step === 'choose' && choice) {
    tickRemember();
    choice.o.face.click(); if (!choice.o.r.checked) choice.o.r.click();
    choice.o.r.dispatchEvent(new Event('change', { bubbles: true }));
    return { picked: choice.kind };
  }
  // After a choice, some pages show a drop-down asking where to send the code. Prefer email, then a text.
  // One call opens the drop-down if it is closed, the next picks from it.
  if (step === 'contact') {
    const native = Q('select').filter(shown).find((sel) => [...sel.options].some((o) => /e-?mail|text/i.test(o.textContent)));
    if (native) {
      const opt = [...native.options].find((o) => /e-?mail/i.test(o.textContent)) ?? [...native.options].find((o) => /text/i.test(o.textContent));
      native.value = opt.value; native.dispatchEvent(new Event('change', { bubbles: true }));
      return { picked: /e-?mail/i.test(opt.textContent) ? 'email' : 'text' };
    }
    // The entries of a home-made drop-down can be any kind of element, so they are found by what they
    // say: the innermost visible element whose text starts with "Email" (else "Text").
    // A home-made control may answer to the press rather than the click, so it is given both.
    const press = (e) => { for (const type of ['pointerdown', 'mousedown']) e.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); e.focus?.(); for (const type of ['pointerup', 'mouseup']) e.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); e.click(); };
    const visible = data.evenHidden ? () => true : shown2;
    const saying = (re) => Q('*').filter((e) => visible(e) && re.test(e.textContent) && e.textContent.trim().length < 60).filter((e, _, all) => !all.some((o) => o !== e && e.contains(o))).at(-1);
    const how = (e) => { const chain = []; for (let n = e; n && chain.length < 4; n = n.parentElement) chain.push(`${n.tagName.toLowerCase()}${n.getAttribute('role') ? `[role=${n.getAttribute('role')}]` : ''}`); return chain.join(' < '); };
    // The control that opens it: something meant to be pressed, before any wrapper that merely has "select" in its name.
    const openers = Q('[aria-haspopup], [role=combobox], [id*="select" i], [id*="dropdown" i]').filter(shown2).filter((e) => !e.matches('input[type=radio], input[type=checkbox]'));
    const opener = openers.find((e) => e.matches('button, input[type=button], [role=combobox], [role=button], [aria-haspopup]')) ?? openers.at(-1);
    // Has a pick registered? Then the control itself now says so.
    const says = `${opener?.value ?? ''} ${opener?.textContent ?? ''} ${opener?.getAttribute?.('aria-label') ?? ''}`;
    if (/e-?mail|text me/i.test(says)) return { picked: /e-?mail/i.test(says) ? 'email' : 'text', within: 'confirmed by the control' };
    const item = saying(/^\s*e-?mail\b/i) ?? saying(/^\s*text\b/i);
    if (item && data.keys && opener) {   // the keyboard way: arrow down to the entry, then Enter
      const entries = Q('[role=option]'), at = entries.findIndex((e) => e.contains(item) || item.contains(e));
      const key = (k) => { for (const type of ['keydown', 'keyup']) (document.activeElement ?? opener).dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, code: k, keyCode: k === 'Enter' ? 13 : 40, which: k === 'Enter' ? 13 : 40 })); };
      opener.focus();
      for (let i = 0; i <= Math.max(at, 0); i++) key('ArrowDown');
      key('Enter');
      return { pressed: `keys to entry ${at + 1} of ${entries.length}` };
    }
    if (item) { const target = item.closest('[role=option], [role=menuitem], li, a, button') ?? item; press(target); if (target !== item) press(item); return { pressed: how(item) }; }
    if (opener) { press(opener); return { opened: how(opener) }; }
    return { nothing: true };
  }
  // Going on is a step of its own: pages often enable the button only once a choice has registered.
  if (step === 'go') { const next = buttons(document).find((b) => /^(next|continue|send|submit|confirm)/i.test(label(b))); if (next) next.click(); return { went: Boolean(next) }; }

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
  // A field that wipes a value placed in one go (one that builds its contents from key presses, to
  // mask them, say) is given the text one key at a time instead. Where the page takes the key for
  // itself, the letter is not added a second time.
  const keyed = (el, text) => {
    enter(el); el.value = '';
    for (const ch of text) {
      const init = { bubbles: true, cancelable: true, key: ch, charCode: ch.charCodeAt(0), keyCode: ch.toUpperCase().charCodeAt(0), which: ch.charCodeAt(0) };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      const taken = !el.dispatchEvent(new KeyboardEvent('keypress', init)), before = el.value;
      if (!taken && el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }))) { if (el.value === before) el.value = before + ch; told(el, 'insertText', ch); }
      el.dispatchEvent(new KeyboardEvent('keyup', init));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const send = (el) => {
    el.blur();
    // The button that says what it does comes first; failing that, the form's own submit button, but never
    // one of the helpers that sit beside a password field (show, forgot, passwordless, register).
    const helper = (b) => /show|hide|forgot|passwordless|passkey|register|activate|enroll|sign up|español/i.test(label(b));
    const named = buttons(el.form ?? document).find((b) => !helper(b) && /^(sign|log) ?(in|on)\b|^continue|^next|^submit|^verify|^confirm/i.test(label(b)));
    const inForm = el.form ? buttons(el.form).filter((b) => b.type === 'submit' && !helper(b)) : [];
    const button = named ?? inForm[0];
    if (button) button.click(); else el.form?.requestSubmit();
  };
  if (step === 'user' && user) { put(user, data.username); if (!user.value) keyed(user, data.username); else nudge(user); send(user); }
  if (step === 'password' && pass) {
    // The username gets the same add-and-remove treatment as the password: some forms only take in a field that saw keys pressed.
    // `trace` says, step by step, whether each field held something (never what), for working out a form that drops a value.
    const trace = [`user field ${user ? `#${user.id.replace(/\d/g, '9')}` : 'not found'}`], held = (tag) => trace.push(`${tag}: user ${user ? Boolean(user.value) : '-'}, password ${Boolean(pass.value)}`);
    if (data.keyed) {   // a site marked as wanting every field key by key
      if (user) { keyed(user, data.username); held('user keyed'); }
      keyed(pass, data.password); held('password keyed'); send(pass); held('sent');
      return { done: true, trace };
    }
    if (user && user.value !== data.username) {
      put(user, data.username); held('user set');
      if (!user.value && data.nudge) { keyed(user, data.username); held('user keyed'); }
      else if (data.nudge) { nudge(user); held('user nudged'); }
    }
    put(pass, data.password); held('password set'); if (data.nudge) { nudge(pass); held('password nudged'); } send(pass); held('sent');
    return { done: true, trace };
  }
  if (step === 'code' && code) {
    tickRemember();
    put(code, data.code); send(code);
  }
  // "Remember this device", where offered, means fewer codes and approvals later.
  // The real checkbox is often hidden behind a styled label, so it is ticked through its label when that is what shows.
  function tickRemember() {
    for (const box of Q('input[type=checkbox]')) {
      if (box.checked || box.disabled || !/remember (this|my) (device|computer|browser)|trust this (device|computer|browser)|don.?t ask (me )?again/i.test(words(box))) continue;
      const face = shown(box) ? box : [...(box.labels ?? [])].find(shown2);
      if (face) face.click();
      if (!box.checked) box.click();
    }
  }
  if (step === 'push' && push) { tickRemember(); push.click(); }
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
async function awaitCode(site, inbox, since, authenticator) {
  const base = TARGETS[site.target];
  let inboxOk = true;
  for (const end = Date.now() + 5 * 60_000, start = Date.now(); Date.now() < end; await sleep(3000)) {
    const typed = await fetch(`${base}/ext/code?site=${site.id}`, { headers: { 'x-coincell': '1' } }).then((r) => r.json()).catch(() => ({}));
    if (typed.code) return { code: typed.code };
    // A code coincell makes from a saved setup key: at once when the page asks for an authenticator,
    // otherwise only after half a minute with no emailed or typed code.
    if (typed.made && (authenticator || Date.now() - start > 30_000)) return { code: typed.made };
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
export async function signIn(site, tab, say, { whateverTheAddress = false } = {}) {
  // An institution can be spread over several sites (sign in on one, land on another): being on the
  // logged-in pages of any of them counts as being in.
  const family = SITES.filter((s) => s.id === site.id && s.target === site.target && s.loggedIn);
  const isIn = (url) => family.some((s) => s.loggedIn.test(url ?? ''));
  if (!site.signIn) return { ok: false };
  const key = `${site.target}:${site.id}`;
  const login = await fetch(`${TARGETS[site.target]}/ext/login?site=${site.id}`, { headers: { 'x-coincell': '1' } }).then((r) => r.json()).catch(() => ({}));
  if (!login.username) return { ok: false, message: login.error };   // no saved login: you log in, as before
  // plainFill is a switch for the tests only: it leaves out the add-and-remove step, to show the careless fake sites do refuse without it.
  const { rejected = {}, plainFill = false } = await chrome.storage.local.get(['rejected', 'plainFill']);
  // The mark names the login and the extension version that failed with it: a newer login or a newer extension gets a fresh try.
  const mark = `${login.savedAt} by ${chrome.runtime.getManifest().version}`;
  if (rejected[key] === mark) return { ok: false, message: 'The saved login was not accepted last time, so it was not tried again. Log in yourself, or save the login again.' };

  // A sign-in form may sit in a frame inside the page. Every frame is looked at, but only the page
  // itself or a frame served from this site's own addresses is ever acted on.
  let frame = 0, actedFrame = 0, frameGone = false;   // actedFrame: the frame the sign-in form was in; once it is gone, the sign-in is over
  const run = (step, data = {}) => chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frame] }, func: onPage, args: [step, data] });
  const look = async () => {
    try {
      const every = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: onPage, args: ['look', {}] });
      frameGone = actedFrame !== 0 && !every.some((r) => r.frameId === actedFrame);
      const seen = every.map((r) => ({ frameId: r.frameId, ...r.result })).filter((f) => f.has && f.has !== 'none' && (f.frameId === 0 || site.signIn.test(f.url ?? '') || site.loggedIn.test(f.url ?? '')));
      const pick = seen.find((f) => f.frameId === 0) ?? seen[0];
      frame = pick?.frameId ?? 0;
      return pick?.has === 'choose' ? `choose ${pick.sig}` : pick?.has ?? 'none';   // each page of choices counts as its own step
    } catch (e) { return /cannot access|permission/i.test(e.message) ? 'blocked' : 'none'; }
  };
  // A sign-in page may wait until it is actually on screen, so its tab and window are brought to the front.
  const front = async () => { await chrome.tabs.update(tab.id, { active: true }).catch(() => {}); await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {}); await sleep(500); };
  // What each page of the sign-in looked like goes to coincell's recordings folder on this computer (layout only).
  let lastNoted = '';
  const note = async (has) => {
    if (has === lastNoted) return; lastNoted = has;
    // The frame being acted on, or, when there is none, whichever frame has the most on it.
    const all = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: onPage, args: ['outline', {}] }).catch(() => []);
    const size = (o) => (o?.headings?.length ?? 0) + (o?.buttons?.length ?? 0) + (o?.fields?.filter((f) => f.shown).length ?? 0);
    const outline = all.find((r) => r.frameId === frame && size(r.result))?.result ?? all.map((r) => r.result).sort((x, y) => size(y) - size(x))[0];
    if (outline) await fetch(`${TARGETS[site.target]}/api/recordings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' },
      body: JSON.stringify({ host: `${site.id}.signin`, entry: { kind: 'signin', at: new Date().toISOString(), version: chrome.runtime.getManifest().version, has, outline } }) }).catch(() => {});
  };
  const acted = new Set();
  let since = Date.now(), quiet = 0, calm = 0, shown = false, patience = 20;   // patience: how many looks (0.7 s apart) a page with nothing to fill in is given
  for (const end = Date.now() + 9 * 60_000; Date.now() < end;) {
    const now = await chrome.tabs.get(tab.id);
    // Normally the address says when you are in. For a site whose address says so even on its sign-in
    // form (whateverTheAddress), you are in once something was filled in and the page has had nothing
    // more to fill in for a few looks.
    const inByAddress = isIn(now.url);
    // (If the form was in a frame, that frame going away is the sign; a page that merely has nothing to fill in may be waiting for you.)
    if (inByAddress && whateverTheAddress && !(acted.size && (actedFrame ? frameGone : calm >= 4))) { /* keep looking at the page */ } else
    if (inByAddress) {
      if (whateverTheAddress) { lastNoted = ''; await note('taken as logged in'); }
      if (rejected[key]) { delete rejected[key]; await chrome.storage.local.set({ rejected }); }
      return { ok: true };
    }
    const has = now.status === 'complete' ? (site.signIn.test(now.url ?? '') ? await look() : 'elsewhere') : 'none';
    if (has === 'blocked') return { ok: false, message: 'Chrome has not been told this extension may fill in this site. Press "Allow sign-in help" in the extension\'s popup.' };
    if (has === 'none' || has === 'elsewhere') {   // still loading, on its way somewhere, or a page with nothing to fill in
      if (has === 'none' && now.status === 'complete') calm++;
      if (quiet === 12 && now.status === 'complete') await note(`${has} (nothing to fill in)`);
      if (whateverTheAddress && !acted.size && quiet > 14) return { ok: false };   // nothing here to sign in to: the read failed for another reason
      if (++quiet > patience) return { ok: false, message: has === 'elsewhere' ? `Its sign-in page is at ${new URL(now.url).hostname}${new URL(now.url).pathname.slice(0, 60)}, which coincell does not fill in. Log in yourself; it will be read as soon as you are in.` : UNKNOWN };
      await sleep(700); continue;
    }
    quiet = 0; calm = 0;
    await note(has);
    if (acted.has(has)) {   // answered this already, and the site is asking again
      lastNoted = ''; await note(`${has} again, after answering it`);
      if (has === 'password') { await chrome.storage.local.set({ rejected: { ...rejected, [key]: mark } }); return { ok: false, message: 'The site did not let the saved login through. It will not be tried again until you save it anew, or log in yourself.' }; }
      return { ok: false, message: has === 'code' ? 'The site did not accept the emailed code. Enter it yourself.' : UNKNOWN };
    }
    if (!shown) { await front(); shown = true; }
    if (has === 'user') { await say('Signing in'); await run('user', { username: login.username }); }
    if (has === 'password') {
      // No more than three tries at a password in an hour, whatever the reason for them: sites lock accounts that are tried too often.
      const { tries = {} } = await chrome.storage.local.get('tries');
      const recent = (tries[key] ?? []).filter((t) => Date.now() - t < 60 * 60_000);
      if (recent.length >= 3 && site.target === 'real') return { ok: false, message: 'The saved login has been tried three times in the last hour, so it is being left alone for now. Log in yourself, or try again later.' };
      await chrome.storage.local.set({ tries: { ...tries, [key]: [...recent, Date.now()] } });
    }
    if (has === 'password') { await say('Signing in'); since = Date.now(); const filled = await run('password', { username: login.username, password: login.password, nudge: !plainFill, keyed: Boolean(site.keyed) }); lastNoted = ''; await note(`filled (${(filled[0]?.result?.trace ?? []).join('; ')})`); }
    if (has === 'code') {
      // Say what the site itself asks for, in its own words (its heading), so you know which code it wants.
      const asks = await run('outline').then((r) => r[0]?.result?.headings?.[0]).catch(() => '');
      if (!(login.makesCodes && /authenticator|verification app/i.test(asks ?? ''))) await say(`${asks ? `The site says: “${asks}”.` : 'The site asks for a code.'} Type the code here; one that is emailed is entered by itself.`, 'needs-code');
      const authenticator = /authenticator|verification app|totp/i.test(`${asks} ${await run('outline').then((r) => (r[0]?.result?.fields ?? []).filter((f) => f.shown).map((f) => `${f.id} ${f.name} ${f.label}`).join(' ')).catch(() => '')}`);
      const got = await awaitCode(site, login.inbox, since, authenticator);
      if (!got.code) return { ok: false, message: got.message };
      await say('Entering the code');
      await run('code', { code: got.code });
    }
    if (has === 'push') {   // the site wants a tap in its phone app: ask for it, then give you three minutes
      const asks = await run('outline').then((r) => r[0]?.result?.headings?.[0]).catch(() => '');
      await run('push');
      await say(`${asks ? `The site says: “${asks}”.` : ''} Approve the sign-in on your phone.`.trim(), 'needs-approval');
      patience = 260;
    }
    if (has.startsWith('choose')) {
      const trail = [];
      const chosen = (await run('choose'))[0]?.result ?? {};
      let picked = chosen.picked;
      if (picked === 'more') {   // "another way" may open a drop-down of ways: pick from it
        await sleep(900);
        for (let i = 0, presses = 0; i < 9; i++) {
          const r = (await run('contact', { evenHidden: i >= 4, keys: presses >= 2 }).catch(() => []))[0]?.result ?? {};
          trail.push(r.picked ? `picked ${r.picked}: ${r.within}` : r.pressed ? `pressed ${r.pressed}` : r.opened ? `opened ${r.opened}` : 'nothing found');
          if (r.picked) { picked = r.picked; break; }
          if (r.nothing) break;
          if (r.pressed) presses++;
          await sleep(700);
        }
        // A drop-down that would not take a pick: fall back to the next way on offer (usually a tap in the site's phone app).
        if (picked === 'more') { picked = (await run('choose', { avoid: 'more' }).catch(() => []))[0]?.result?.picked ?? 'more'; trail.push(`fell back to ${picked}`); }
      }
      let went = false;
      for (let i = 0; i < (chosen.cards ? 0 : 6) && !went; i++) { await sleep(600); went = Boolean((await run('go').catch(() => []))[0]?.result?.went); }
      await sleep(1500); await note(`after choosing ${picked} (next pressed: ${went}; ${trail.join(', ')})`);
      if (picked === 'push') { await say('Approve the sign-in on your phone.', 'needs-approval'); patience = 260; }
      else await say(picked === 'email' ? 'Asked the site to email a code' : picked === 'text' ? 'Asked the site to text a code' : 'Choosing how the site should reach you');
      since = Date.now();
    }
    if (has === 'remember') await run('remember');
    acted.add(has); if (frame) actedFrame = frame;
    // Give the site time to move on: until it shows something else, for up to 20 seconds.
    for (const until = Date.now() + 20_000; Date.now() < until; await sleep(600)) {
      const t = await chrome.tabs.get(tab.id);
      if ((isIn(t.url) && !whateverTheAddress) || (t.status === 'complete' && (await look()) !== has)) break;
    }
  }
  return { ok: false, message: UNKNOWN };
}

/** Record the layout (never the values) of whatever pages of this site are open, without doing anything to them. */
export async function describe(site) {
  const tabs = (await chrome.tabs.query({})).filter((t) => site.match.test(t.url ?? '') || site.signIn?.test(t.url ?? '') || site.loggedIn?.test(t.url ?? ''));
  for (const tab of tabs) {
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: onPage, args: ['outline', {}] }).catch(() => []);
    for (const f of frames) {
      const o = f.result;
      if (!o || !((o.headings?.length ?? 0) + (o.buttons?.length ?? 0) + (o.fields?.filter((x) => x.shown).length ?? 0))) continue;
      await fetch(`${TARGETS[site.target]}/api/recordings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coincell': '1' },
        body: JSON.stringify({ host: `${site.id}.signin`, entry: { kind: 'signin', at: new Date().toISOString(), version: chrome.runtime.getManifest().version, has: `described (frame ${f.frameId})`, outline: o } }) }).catch(() => {});
    }
  }
  return tabs.length;
}
