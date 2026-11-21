import { dataPath } from './paths.js';

/**
 * Open a visible browser with a profile kept per bank, so cookies and
 * "remember this device" survive between syncs. You type your credentials
 * and 2FA codes into the bank's own page; this app never sees or stores them.
 */
export async function openBrowser(bankId) {
  const { chromium } = await import('playwright');
  const profile = dataPath('profiles', bankId, '.keep').replace(/\.keep$/, '');
  // COINCELL_HEADLESS=1 hides the window; only useful for sites that need no typing from you.
  const opts = { headless: process.env.COINCELL_HEADLESS === '1', viewport: null };
  try {
    return await chromium.launchPersistentContext(profile, { ...opts, channel: 'chrome' });
  } catch {
    // Google Chrome not installed: use Playwright's own Chromium (npx playwright install chromium).
    return await chromium.launchPersistentContext(profile, opts);
  }
}

/** Wait (default up to 10 minutes) for you to finish logging in by hand. */
export async function waitForLogin(page, { url, selector, timeout = 10 * 60_000 } = {}) {
  if (selector) await page.waitForSelector(selector, { timeout });
  else if (url) await page.waitForURL(url, { timeout });
  else throw new Error('waitForLogin needs a url pattern or a selector that only appears after login');
}

/**
 * Collect JSON responses whose URL matches `pattern` while `action` runs.
 * Reading the site's own JSON calls is far sturdier than scraping the DOM.
 */
export async function captureJson(page, pattern, action, { settleMs = 1500 } = {}) {
  const hits = [];
  const onResponse = async (res) => {
    if (!pattern.test(res.url())) return;
    try { hits.push({ url: res.url(), body: await res.json() }); } catch { /* not JSON */ }
  };
  page.on('response', onResponse);
  try {
    await action();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(settleMs);
  } finally {
    page.off('response', onResponse);
  }
  return hits;
}

/** "$1,234.56", "(1,234.56)", "-$12.00", "$-12.00", "+$3.10", "1 234,56 CR" -> number */
export function parseMoney(text) {
  if (typeof text === 'number') return text;
  const s = String(text ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^[^\d]*[-−–]/.test(s) || /[-−–]$/.test(s) || /\bDR\b/i.test(s); // "-$5", "$-5", "(5)", "5-"
  let digits = s.replace(/[^\d.,]/g, '');
  if (/,\d{2}$/.test(digits) && !/\.\d{2}$/.test(digits)) digits = digits.replace(/\./g, '').replace(',', '.');
  else digits = digits.replace(/,/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && digits ? (negative ? -n : n) : null;
}
