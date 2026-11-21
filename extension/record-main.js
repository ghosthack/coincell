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
  const note = (method, url, status, body) => { try { emit({ kind: 'data', method, url: cleanUrl(url), status, shape: shape(JSON.parse(body)) }); } catch { /* not JSON */ } };

  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await realFetch.apply(this, arguments);
    try {
      if ((res.headers.get('content-type') ?? '').includes('json')) {
        res.clone().text().then((t) => note((init?.method ?? input?.method ?? 'GET').toUpperCase(), res.url || String(input?.url ?? input), res.status, t), () => {});
      }
    } catch { /* never disturb the page */ }
    return res;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('load', () => { try { if ((this.getResponseHeader('content-type') ?? '').includes('json') && typeof this.responseText === 'string') note(String(method).toUpperCase(), url, this.status, this.responseText); } catch { /* ignore */ } });
    return open.apply(this, arguments);
  };

  // The page's outline: which elements carry ids, classes and data- attributes, with all text masked.
  const mask = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 48).replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a');
  function outline() {
    const lines = [];
    const walk = (el, depth) => {
      if (lines.length >= 500 || depth > 14 || /^(SCRIPT|STYLE|SVG|NOSCRIPT|IFRAME)$/i.test(el.tagName)) return;
      const attrs = [...el.attributes].filter((a) => /^(id|class|role|name|type|href)$|^data-|^aria-label$/.test(a.name))
        .map((a) => (a.name === 'id' ? `#${a.value}` : a.name === 'class' ? `.${a.value.trim().split(/\s+/).slice(0, 4).join('.')}` : a.name === 'href' ? `[href=${cleanUrl(a.value).replace(location.origin, '')}]` : `[${a.name}${/^data-|^name$|^type$|^role$/.test(a.name) ? `=${a.name.startsWith('data-') ? mask(a.value) : a.value}` : ''}]`)).join('');
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
      const interesting = attrs || /^(TABLE|THEAD|TBODY|TR|TH|TD|DL|DT|DD|H1|H2|H3|FORM|BUTTON|A|INPUT|SELECT|MAIN|SECTION|NAV|UL|LI)$/.test(el.tagName);
      if (interesting) lines.push(`${'  '.repeat(Math.min(depth, 10))}${el.tagName.toLowerCase()}${attrs}${mask(own) ? ` "${mask(own)}"` : ''}`);
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
