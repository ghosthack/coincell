// Capture. For sites whose data feeds need tokens only the site's own pages have, coincell does
// not compose requests itself. It opens the site's normal pages in your tab and keeps a copy of
// what the pages ask and the answers they receive. The copies stay in the page's memory until
// collected; a site script may repeat one of the page's own requests with a different date range.
(() => {
  if (window.__coincellCapture) return;
  const store = window.__coincellCapture = [];
  const root = location.hostname.split('.').slice(-2).join('.');
  const same = (u) => { try { const h = new URL(u, location.href).hostname; return h === root || h.endsWith(`.${root}`); } catch { return false; } };
  const keep = (method, url, status, text, sent) => {
    if (!same(url)) return;
    try { store.push({ method, url: new URL(url, location.href).href, status, body: JSON.parse(text), sent }); if (store.length > 400) store.shift(); } catch { /* not JSON */ }
  };
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    let url = '', method = 'GET', sent;
    try {
      const req = input instanceof Request ? input : null;
      url = req ? req.url : String(input);
      method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      const headers = { ...(req ? Object.fromEntries(req.headers) : {}), ...(init?.headers ? Object.fromEntries(new Headers(init.headers)) : {}) };
      const body = typeof init?.body === 'string' ? init.body : req && method !== 'GET' && init?.body == null ? await req.clone().text() : undefined;
      sent = { headers, body };
    } catch { /* never disturb the page */ }
    const res = await realFetch.apply(this, arguments);
    try {
      if ((res.headers.get('content-type') ?? '').includes('json')) res.clone().text().then((t) => keep(method, res.url || url, res.status, t, sent), () => {});
    } catch { /* never disturb the page */ }
    return res;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send, setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) { this.__cc = { method: String(method).toUpperCase(), url, headers: {} }; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) { try { if (this.__cc) this.__cc.headers[String(name).toLowerCase()] = String(value); } catch { /* ignore */ } return setHeader.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__cc;
    if (info) this.addEventListener('load', async () => {
      try {   // the answer may be text, a ready-made object, a blob or raw bytes, depending on how the page asked
        const r = this.response, kind = this.responseType;
        const text = kind === '' || kind === 'text' ? this.responseText : kind === 'json' ? JSON.stringify(r) : kind === 'blob' ? await r.text() : kind === 'arraybuffer' ? new TextDecoder().decode(r) : '';
        keep(info.method, info.url, this.status, text, { headers: info.headers, body: typeof body === 'string' ? body : undefined });
      } catch { /* ignore */ }
    });
    return send.apply(this, arguments);
  };
})();
