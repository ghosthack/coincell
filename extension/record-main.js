// Recording. Notes the SHAPE of the data a site loads and the outline of its pages, never the
// values: every string becomes "string", every number "number", and page text has each letter
// and digit replaced. That is enough to write a site script and contains nothing about you.
(() => {
  if (window.__coincellRecording) return;
  window.__coincellRecording = true;
  const emit = (entry) => window.postMessage({ __coincellRecord: entry }, location.origin);

  const shape = (v, depth = 0) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : [];
    if (typeof v === 'object') return depth > 8 ? '{...}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
    if (typeof v === 'string') return /^-?[\d,.]+$/.test(v) ? 'numeric-string' : /^\d{4}-\d{2}-\d{2}/.test(v) ? 'date-string' : 'string';
    return typeof v;
  };
  const cleanUrl = (u) => {
    const x = new URL(u, location.href);
    for (const k of [...x.searchParams.keys()]) x.searchParams.set(k, '_');
    return x.origin + x.pathname.replace(/[0-9a-f-]{16,}|\d{4,}/gi, ':id') + x.search;
  };
  // Only the site's own services matter; analytics, chat widgets and the like are skipped.
  const siteRoot = location.hostname.split('.').slice(-2).join('.');
  const sameSite = (u) => { try { const h = new URL(u, location.href).hostname; return h === siteRoot || h.endsWith(`.${siteRoot}`); } catch { return false; } };
  const mask = (s) => String(s).slice(0, 60).replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a');
  // What the page SENT, so the same question can be asked again later: the structure is kept, and
  // every value is masked to its pattern ("2026-11-20" becomes "9999-99-99"). The names of
  // operations and the text of queries are kept, since they are part of the site, not of you.
  const maskValues = (v, key = '', depth = 0) => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return /^(operationName|operation)$/i.test(key) ? v : /^query$/i.test(key) ? v.slice(0, 4000).replace(/[0-9]{4,}/g, '#') : mask(v);
    if (Array.isArray(v)) return v.length ? [maskValues(v[0], key, depth + 1), `(${v.length} items)`] : [];
    return depth > 8 ? '{...}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskValues(x, k, depth + 1)]));
  };
  const sentShape = (body) => {
    if (body == null || body === '') return undefined;
    if (typeof body !== 'string') return `(${body.constructor?.name ?? typeof body})`;
    try { return maskValues(JSON.parse(body)); } catch { /* not JSON */ }
    if (/^[\w.%+-]+=/.test(body)) return Object.fromEntries([...new URLSearchParams(body)].map(([k, v]) => [k, mask(v)]));
    return `(text, ${body.length} characters)`;
  };
  const headerNames = (h) => { try { return h ? [...new Headers(h).keys()] : []; } catch { return []; } };
  const note = (method, url, status, body, sent, headers) => {
    if (!sameSite(url)) return;
    try { emit({ kind: 'data', method, url: cleanUrl(url), status, sentHeaders: headers, sent: sentShape(sent), shape: shape(JSON.parse(body)) }); } catch { /* not JSON */ }
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
      if ((res.headers.get('content-type') ?? '').includes('json')) res.clone().text().then((t) => note(method, res.url || url, res.status, t, sent, headers), () => {});
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
    if (info) this.addEventListener('load', () => { try { if ((this.getResponseHeader('content-type') ?? '').includes('json') && typeof this.responseText === 'string') note(info.method, info.url, this.status, this.responseText, body, info.headers); } catch { /* ignore */ } });
    return send.apply(this, arguments);
  };

  // The page's outline: which elements carry ids, classes and data- attributes, with all text masked.
  const maskText = (s) => mask(s.replace(/\s+/g, ' ').trim().slice(0, 48));
  function outline() {
    const lines = [];
    const walk = (el, depth) => {
      if (lines.length >= 500 || depth > 14 || /^(SCRIPT|STYLE|SVG|NOSCRIPT|IFRAME)$/i.test(el.tagName)) return;
      const attrs = [...el.attributes].filter((a) => /^(id|class|role|name|type|href)$|^data-|^aria-label$/.test(a.name))
        .map((a) => (a.name === 'id' ? `#${a.value}` : a.name === 'class' ? `.${a.value.trim().split(/\s+/).slice(0, 4).join('.')}` : a.name === 'href' ? `[href=${cleanUrl(a.value).replace(location.origin, '')}]` : `[${a.name}${/^data-|^name$|^type$|^role$/.test(a.name) ? `=${a.name.startsWith('data-') ? maskText(a.value) : a.value}` : ''}]`)).join('');
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
      const interesting = attrs || /^(TABLE|THEAD|TBODY|TR|TH|TD|DL|DT|DD|H1|H2|H3|FORM|BUTTON|A|INPUT|SELECT|MAIN|SECTION|NAV|UL|LI)$/.test(el.tagName);
      if (interesting) lines.push(`${'  '.repeat(Math.min(depth, 10))}${el.tagName.toLowerCase()}${attrs}${maskText(own) ? ` "${maskText(own)}"` : ''}`);
      const kids = [...el.children];
      kids.slice(0, 40).forEach((k, i) => { if (!(el.tagName === 'TBODY' && i >= 3) && !(el.tagName === 'UL' && i >= 4)) walk(k, depth + (interesting ? 1 : 0)); });
    };
    if (document.body) walk(document.body, 0);
    emit({ kind: 'page', url: cleanUrl(location.href), outline: lines });
  }
  let last = '';
  const snap = () => { if (location.href !== last) { last = location.href; setTimeout(outline, 1500); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', snap); else snap();
  setInterval(snap, 1000); // single-page apps change the address without loading a new page
})();
