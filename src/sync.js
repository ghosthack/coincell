import { pathToFileURL } from 'node:url';
import { BANKS, getBank } from './banks/index.js';
import { saveSnapshot, linkTransfers, recordImport } from './db.js';

export const state = { running: false, bank: null, startedAt: null, log: [], last: null };

async function syncOne(bank, log) {
  let context;
  try {
    const ctx = { log };
    if (bank.needsBrowser) {
      const { openBrowser } = await import('./browser.js');
      context = await openBrowser(bank.id);
      ctx.context = context;
      ctx.page = context.pages()[0] ?? await context.newPage();
    }
    const result = await bank.sync(ctx);
    const snaps = Array.isArray(result) ? result : [result];
    for (const s of snaps) saveSnapshot(bank.id, s);
    return snaps.at(-1)?.accounts?.length ?? 0;
  } finally {
    await context?.close().catch(() => {});
  }
}

/** Sync one institution, or every registered one in turn with bankId "all". */
export async function runSync(bankId) {
  // "all" leaves out institutions the browser extension feeds; those are sent from Chrome.
  const banks = bankId === 'all' ? BANKS.filter((b) => !b.viaExtension) : [getBank(bankId)];
  if (!banks[0]) throw new Error(`Unknown bank "${bankId}"`);
  if (state.running) throw new Error(`A sync of ${state.bank} is already running`);
  Object.assign(state, { running: true, bank: bankId, startedAt: new Date().toISOString(), log: [] });
  let accounts = 0;
  const failed = [];
  try {
    for (const bank of banks) {
      const log = (msg) => { state.log.push(`${bank.name}: ${msg}`); console.log(`[${bank.id}] ${msg}`); };
      try {
        const n = await syncOne(bank, log);
        accounts += n;
        recordImport(bank.id, true, `${n} account${n === 1 ? '' : 's'} read`);
      } catch (e) {
        recordImport(bank.id, false, e.message.split('\n')[0]);
        log(`Failed: ${e.message.split('\n')[0]}`);
        failed.push(`${bank.name} (${e.message.split('\n')[0]})`);
      }
    }
    const linked = linkTransfers();
    const done = banks.length - failed.length;
    const message = `${done} of ${banks.length} institution${banks.length === 1 ? '' : 's'} synced, ${accounts} account${accounts === 1 ? '' : 's'}${linked ? `, ${linked} new transfer${linked === 1 ? '' : 's'} matched` : ''}`
      + (failed.length ? `. Failed: ${failed.join('; ')}` : '');
    console.log(message);
    state.last = { bank: bankId, ok: !failed.length, at: new Date().toISOString(), message };
    if (failed.length) throw new Error(message);
  } finally {
    state.running = false;
  }
}

// CLI: npm run sync -- <bank>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const id = process.argv[2];
  if (!id) {
    console.log(`Usage: npm run sync -- <bank>\nBanks: all, ${BANKS.map((b) => b.id).join(', ')}`);
    process.exit(1);
  }
  runSync(id).catch(() => process.exit(1));
}
