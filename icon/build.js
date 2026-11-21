// Renders scene.js with three.js in headless Chromium, crops it square and writes
// every icon file the app and the README use. Run from this directory after `npm ci`:
//   node build.js            (Playwright comes from the main project's node_modules)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = __dirname, three = path.join(root, 'node_modules/three');
const RENDER_SIZE = 2400, MARGIN = 0.06;
const OUTPUTS = [[1024, 'coincell.png'], [256, '../public/icon.png'], [64, '../public/favicon.png']];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: RENDER_SIZE, height: RENDER_SIZE } });
  page.on('pageerror', (e) => console.log('error:', e.message));
  await page.route('http://icon.local/**', (r) => {
    const u = new URL(r.request().url()).pathname;
    const f = u.startsWith('/three/') ? path.join(three, u.slice(7)) : path.join(root, u);
    r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await page.route('http://icon.local/', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <style>html,body{margin:0;background:transparent}canvas{display:block}</style>
    <script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
    <script>window.ICON_SIZE=${RENDER_SIZE};Object.assign(window, ${process.argv[2] || '{}'});</script>
    <script type="module" src="/scene.js"></script>` }));
  await page.goto('http://icon.local/');
  await page.waitForFunction(() => window.RENDERED, null, { timeout: 120000 });

  // Crop a square centred on the rendered part (ignoring the shadow's faintest fringe) with an even margin, then scale down in halves for clean edges.
  const images = await page.evaluate(({ margin, sizes }) => {
    const src = document.querySelector('canvas');
    const flat = document.createElement('canvas'); flat.width = src.width; flat.height = src.height;
    const g = flat.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, flat.width, flat.height);
    let l = width, t = height, r = 0, b = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 20) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    const side = Math.max(r - l, b - t) / (1 - 2 * margin), cx = (l + r) / 2, cy = (t + b) / 2;
    return sizes.map((size) => {
      let cur = document.createElement('canvas'); cur.width = cur.height = Math.round(side);
      cur.getContext('2d').drawImage(flat, Math.round(cx - side / 2), Math.round(cy - side / 2), Math.round(side), Math.round(side), 0, 0, cur.width, cur.height);
      while (cur.width / 2 >= size) { const n = document.createElement('canvas'); n.width = n.height = Math.round(cur.width / 2); const c = n.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
      const out = document.createElement('canvas'); out.width = out.height = size; const c = out.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(cur, 0, 0, size, size);
      return out.toDataURL('image/png').split(',')[1];
    });
  }, { margin: MARGIN, sizes: OUTPUTS.map(([s]) => s) });
  OUTPUTS.forEach(([size, file], i) => { fs.writeFileSync(path.join(root, file), Buffer.from(images[i], 'base64')); console.log(`${file} ${size}px`); });
  await browser.close();
})();
