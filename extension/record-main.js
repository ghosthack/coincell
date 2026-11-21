// Recording. Notes the SHAPE of the data a site loads and the outline of its pages, never the
// values: every string becomes "string", every number "number", and page text has each letter
// and digit replaced. That is enough to write a site script and contains nothing about you.
(() => {
  if (window.__coincellRecording) return;
  window.__coincellRecording = true;
  const emit = (entry) => window.postMessage({ __coincellRecord: entry }, location.origin);

  // Field names and types, values removed. For a list, the fields of ALL its items are merged,
  // since rows of different kinds carry different fields. A list of saved answers (items with a
  // `url` and a `response`, as some sites bundle them) is laid out per address. The only values
  // kept are short labels in fields named "...Type" or "...Code", which say what kind of thing
  // a row is ("CHECKING", "POSITION"), never who or how much.
  const label = (k, x) => /(type|code|category|status)$/i.test(k) && typeof x === 'string' && /^[A-Za-z][A-Za-z _-]{0,23}$/.test(x);
  const shape = (v, depth = 0) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) {
      if (!v.length) return [];
      if (!v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return [shape(v[0], depth + 1), `(${v.length} items)`];
      if (v.every((x) => typeof x.url === 'string' && 'response' in x)) {
        const perUrl = {};
        for (const x of v) { const u = cleanUrl(x.url).replace(location.origin, ''); perUrl[u] = perUrl[u] ? mergeShapes(perUrl[u], shape(x, depth + 1)) : shape(x, depth + 1); }
        return [{ 'saved answers, by address': perUrl }, `(${v.length} items)`];
      }
      let merged = {};
      const labels = {};
      for (const item of v) {
        for (const [k, x] of Object.entries(item)) if (label(k, x)) (labels[k] ??= new Set()).add(x);
        merged = mergeShapes(merged, shape(item, depth + 1));
      }
      for (const [k, set] of Object.entries(labels)) merged[k.replace(/[0-9]{4,}/g, '#')] = `one of: ${[...set].slice(0, 16).join(' | ')}`;
      return [merged, `(${v.length} items)`];
    }
    if (typeof v === 'object') {
      if (depth > 10) return '{...}';
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/[0-9]{4,}/g, '#'), label(k, x) ? `label: ${x}` : shape(x, depth + 1)]));
    }
    if (typeof v === 'string') return /^-?[\d,.]+$/.test(v) ? 'numeric-string' : /^\d{4}-\d{2}-\d{2}/.test(v) ? 'date-string' : 'string';
    return typeof v;
  };
  const mergeShapes = (a, b) => {
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out = { ...a };
      for (const [k, x] of Object.entries(b)) out[k] = k in out ? mergeShapes(out[k], x) : x;
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) return a.length && b.length ? [mergeShapes(a[0], b[0]), a[1]] : a.length ? a : b;
    if (typeof a === 'string' && typeof b === 'string' && a !== b && a.startsWith('label: ') && b.startsWith('label: ')) return `one of: ${a.slice(7)} | ${b.slice(7)}`;
    if (typeof a === 'string' && a.startsWith('one of: ') && typeof b === 'string' && b.startsWith('label: ')) return a.includes(b.slice(7)) ? a : `${a} | ${b.slice(7)}`;
    return a === 'null' || a === undefined ? b : a;
  };
  // An address with its identifying parts removed. Query values are kept only when they are a
  // plain word, true/false or a number under 1000 ("DESC", "true", "50"): settings, not identities.
  // The part after # (the page's route inside the site) is kept, with long numbers removed.
  const safeWord = (v) => /^(true|false|[A-Za-z][A-Za-z_-]{0,24}|\d{1,3})$/.test(v);
  const cleanUrl = (u) => {
    const x = new URL(u, location.href);
    for (const [k, v] of [...x.searchParams.entries()]) x.searchParams.set(k, safeWord(v) ? v : '_');
    return x.origin + x.pathname.replace(/[0-9a-f-]{16,}|\d{4,}/gi, ':id') + x.search + x.hash.replace(/[0-9a-f-]{16,}|\d{4,}/gi, ':id').replace(/=[^&;/]*[a-z][^&;/]*/g, (m) => (safeWord(m.slice(1)) ? m : '=_'));
  };
  // Only the site's own services matter; analytics, chat widgets and the like are skipped.
  const siteRoot = location.hostname.split('.').slice(-2).join('.');
  const sameSite = (u) => { try { const h = new URL(u, location.href).hostname; return h === siteRoot || h.endsWith(`.${siteRoot}`); } catch { return false; } };
  const mask = (s) => String(s).slice(0, 60).replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a');
  const maskDigits = (s) => String(s).slice(0, 60).replace(/[0-9]{3,}/g, '#');   // keeps names such as "ag-row", hides ids
  // What the page SENT, so the same question can be asked again later: the structure is kept, and
  // every value is masked to its pattern ("2026-11-20" becomes "9999-99-99"). The names of
  // operations and the text of queries are kept, since they are part of the site, not of you.
  const maskValues = (v, key = '', depth = 0) => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1000 ? v : 'number';   // small counts are settings
    if (typeof v === 'string') return /^(operationName|operation)$/i.test(key) ? v : /^query$/i.test(key) ? v.slice(0, 4000).replace(/[0-9]{4,}/g, '#')
      : /^(true|false|[A-Z][A-Z_]{1,40})$/.test(v) ? v : mask(v);   // CAPITAL_WORDS are the site's own constants; everything else is masked
    if (Array.isArray(v)) return v.length ? [maskValues(v[0], key, depth + 1), `(${v.length} items)`] : [];
    return depth > 8 ? '{...}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskValues(x, k, depth + 1)]));
  };
  const sentShape = (body) => {
    if (body == null || body === '') return undefined;
    if (typeof body !== 'string') return `(${body.constructor?.name ?? typeof body})`;
    try { return maskValues(JSON.parse(body)); } catch { /* not JSON */ }
    if (/^[\w.%+-]+=/.test(body)) return { '(sent as a form)': Object.fromEntries([...new URLSearchParams(body)].map(([k, v]) => [k, maskValues(v)])) };
    return `(text, ${body.length} characters)`;
  };
  const headerNames = (h) => { try { return h ? [...new Headers(h).keys()] : []; } catch { return []; } };
  // Every answer from the site's own services is noted. JSON gets its full shape. Anything else
  // (text, pieces of a multi-part answer, binary) is listed with its type and size, plus the
  // shape of any JSON found inside it, so data that arrives in an unusual wrapper is not missed.
  const note = (method, url, status, body, sent, headers, type = '') => {
    if (!sameSite(url)) return;
    const base = { method, url: cleanUrl(url), status, sentHeaders: headers, sent: sentShape(sent) };
    try { return emit({ kind: 'data', ...base, shape: shape(JSON.parse(body)) }); } catch { /* not plain JSON */ }
    if (/image|font|css|javascript|html|video|audio/.test(type)) return;
    const inside = [];
    for (const line of String(body ?? '').split(/\r?\n/)) { const t = line.replace(/^data:\s*/, '').trim(); if (inside.length < 6 && /^[{[]/.test(t)) { try { inside.push(shape(JSON.parse(t))); } catch { /* not JSON */ } } }
    emit({ kind: 'other', ...base, type, length: String(body ?? '').length, inside });
  };

  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    let sent, headers = [], method = 'GET', url = '';
    try {
      const req = input instanceof Request ? input : null;
      url = req ? req.url : String(input);
      method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      headers = [...new Set([...headerNames(req?.headers), ...headerNames(init?.headers)])];
      sent = typeof init?.body === 'string' ? init.body : init?.body != null ? init.body : req && method !== 'GET' ? await req.clone().text() : undefined;
    } catch { /* never disturb the page */ }
    const res = await realFetch.apply(this, arguments);
    try {
      const type = res.headers.get('content-type') ?? '';
      if (sameSite(res.url || url) && !/image|font|css|javascript|video|audio/.test(type)) res.clone().text().then((t) => note(method, res.url || url, res.status, t, sent, headers, type), () => {});
    } catch { /* never disturb the page */ }
    return res;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send, setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cc = { method: String(method).toUpperCase(), url, headers: [] };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name) { try { this.__cc?.headers.push(String(name).toLowerCase()); } catch { /* ignore */ } return setHeader.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__cc;
    if (info) this.addEventListener('load', async () => {
      try {
        const r = this.response, kind = this.responseType;
        const text = kind === '' || kind === 'text' ? this.responseText : kind === 'json' ? JSON.stringify(r) : kind === 'blob' ? await r.text() : kind === 'arraybuffer' ? new TextDecoder().decode(r) : '';
        note(info.method, info.url, this.status, text, body, info.headers, this.getResponseHeader('content-type') ?? '');
      } catch { /* ignore */ }
    });
    return send.apply(this, arguments);
  };

  // Other routes data can take: background workers, live connections, and requests that
  // finished before recording began. Only their addresses are noted.
  try {
    const RealWorker = window.Worker;
    window.Worker = new Proxy(RealWorker, { construct(target, args) { try { emit({ kind: 'worker', url: cleanUrl(String(args[0])) }); } catch { /* ignore */ } return new target(...args); } });
    for (const name of ['WebSocket', 'EventSource']) {
      const Real = window[name];
      if (Real) window[name] = new Proxy(Real, { construct(target, args) { try { emit({ kind: 'live', type: name, url: cleanUrl(String(args[0])) }); } catch { /* ignore */ } return new target(...args); } });
    }
    const earlier = [...new Set(performance.getEntriesByType('resource').filter((r) => /fetch|xmlhttprequest/.test(r.initiatorType) && sameSite(r.name)).map((r) => cleanUrl(r.name)))];
    if (earlier.length) emit({ kind: 'earlier', urls: earlier.slice(0, 200) });
  } catch { /* never disturb the page */ }

  // The page's outline: which elements carry ids, classes and data- attributes, with all text
  // masked. Menus, headers and footers are skipped, repeated rows are cut to the first three,
  // and the insides of web components are included.
  const maskText = (s) => mask(s.replace(/\s+/g, ' ').trim().slice(0, 48));
  function outline() {
    const lines = [];
    const walk = (el, depth) => {
      if (lines.length >= 1500 || depth > 30 || /^(SCRIPT|STYLE|SVG|NOSCRIPT|IFRAME|HEADER|NAV|FOOTER|LINK|META)$/i.test(el.tagName)) return;
      if (/^(navigation|banner|contentinfo|dialog)$/.test(el.getAttribute('role') ?? '')) return;
      const attrs = [...el.attributes].filter((a) => /^(id|class|role|name|type|href|col-id|row-index|headers)$|^data-|^aria-label$/.test(a.name))
        .map((a) => (a.name === 'id' ? `#${maskDigits(a.value)}` : a.name === 'class' ? `.${a.value.trim().split(/\s+/).slice(0, 4).map(maskDigits).join('.')}` : a.name === 'href' ? '[href]'
          : `[${a.name}${/^(name|type|role|col-id|headers)$/.test(a.name) ? `=${maskDigits(a.value)}` : a.name.startsWith('data-') ? `=${maskText(a.value)}` : ''}]`)).join('');
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
      const interesting = attrs || /^(TABLE|THEAD|TBODY|TR|TH|TD|DL|DT|DD|H1|H2|H3|FORM|BUTTON|A|INPUT|SELECT|MAIN|SECTION|UL|LI)$/.test(el.tagName) || el.tagName.includes('-');
      if (interesting) lines.push(`${'  '.repeat(Math.min(depth, 14))}${el.tagName.toLowerCase()}${attrs}${maskText(own) ? ` "${maskText(own)}"` : ''}`);
      const seen = new Map();
      for (const k of [...(el.shadowRoot?.children ?? []), ...el.children]) {
        const sig = `${k.tagName}.${(k.getAttribute('class') ?? '').replace(/\d+/g, '')}`;
        seen.set(sig, (seen.get(sig) ?? 0) + 1);
        if (seen.get(sig) <= 3) walk(k, depth + (interesting ? 1 : 0));
      }
    };
    if (document.body) walk(document.body, 0);
    emit({ kind: 'page', url: cleanUrl(location.href), outline: lines });
  }
  let last = '';
  const snap = () => { if (location.href !== last) { last = location.href; setTimeout(outline, 1500); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', snap); else snap();
  setInterval(snap, 1000); // single-page apps change the address without loading a new page
})();
