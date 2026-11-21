// Shows what a website can tell about the browser coincell drives, using the fake bank's
// /_browser page. Run with the demo up:  node scripts/what-sites-see.js
// Compare with your everyday browser by opening http://localhost:4701/_browser in it.
import { openBrowser } from '../src/browser.js';

const context = await openBrowser('what-sites-see');
const page = context.pages()[0] ?? await context.newPage();
await page.goto('http://localhost:4701/_browser');
const sent = await page.locator('td[id^="h-"]').evaluateAll((tds) => Object.fromEntries(tds.map((td) => [td.id.slice(2), td.textContent])));
const seen = await page.evaluate(() => window.__seen);
console.log(`Hidden window: ${process.env.COINCELL_HEADLESS === '1' ? 'yes' : 'no'}`);
for (const [k, v] of Object.entries({ ...sent, ...seen })) console.log(`  ${k.padEnd(52)} ${v}`);
await context.close();
