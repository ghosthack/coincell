// Passes what record-main.js captures in the page on to the extension.
if (!globalThis.__coincellRelay) {
  globalThis.__coincellRelay = true;
  window.addEventListener('message', (ev) => {
    if (ev.source === window && ev.data?.__coincellRecord) chrome.runtime.sendMessage({ type: 'rec-entry', entry: ev.data.__coincellRecord }).catch(() => {});
  });
}
