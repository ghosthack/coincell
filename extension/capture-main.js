// Capture. For sites whose data feeds need tokens only the site's own pages have, coincell does
// not ask the site anything itself. It opens the site's normal pages in your tab and keeps a copy
// of the answers the pages receive anyway. The copies live in the page's memory until collected.
(() => {
  if (window.__coincellCapture) return;
  const store = window.__coincellCapture = [];
  const root = location.hostname.split('.').slice(-2).join('.');
  const same = (u) => { try { const h = new URL(u, location.href).hostname; return h === root || h.endsWith(`.${root}`); } catch { return false; } };
  const keep = (method, url, status, text) => {
    if (!same(url)) return;
    try { store.push({ method, url: new URL(url, location.href).href, status, body: JSON.parse(text) }); if (store.length > 400) store.shift(); } catch { /* not JSON */ }
  };
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await realFetch.apply(this, arguments);
    try {
      const url = res.url || (input instanceof Request ? input.url : String(input));
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if ((res.headers.get('content-type') ?? '').includes('json')) res.clone().text().then((t) => keep(method, url, res.status, t), () => {});
    } catch { /* never disturb the page */ }
    return res;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('load', () => { try { if (typeof this.responseText === 'string') keep(String(method).toUpperCase(), url, this.status, this.responseText); } catch { /* ignore */ } });
    return open.apply(this, arguments);
  };
})();
