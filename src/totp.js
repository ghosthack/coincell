// Authenticator codes (RFC 6238, the scheme every authenticator app uses): a code is arithmetic on
// a setup key and the current time, so anything holding the key shows the same code.
import { createHmac } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fromBase32(text) {
  let bits = '';
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('That does not look like an authenticator setup key');
    bits += v.toString(2).padStart(5, '0');
  }
  return Buffer.from(bits.slice(0, bits.length - (bits.length % 8)).match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
}

/** Read a setup key as typed (letters and digits, spaces allowed) or as an otpauth:// address. */
export function parseSetupKey(input) {
  const text = String(input ?? '').trim();
  let secret = text, digits = 6, period = 30, algorithm = 'sha1';
  if (/^otpauth:\/\//i.test(text)) {
    const url = new URL(text);
    if (url.hostname.toLowerCase() !== 'totp') throw new Error('Only time-based authenticator keys are supported');
    secret = url.searchParams.get('secret') ?? '';
    digits = Number(url.searchParams.get('digits')) || 6;
    period = Number(url.searchParams.get('period')) || 30;
    algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase();
  }
  secret = secret.toUpperCase().replace(/[\s=-]/g, '');
  if (fromBase32(secret).length < 10 || ![6, 7, 8].includes(digits) || !['sha1', 'sha256', 'sha512'].includes(algorithm)) throw new Error('That does not look like an authenticator setup key');
  return { secret, digits, period, algorithm };
}

/** The code for a key at a moment, and how many seconds it stays valid. */
export function totp(key, at = Date.now()) {
  const { secret, digits = 6, period = 30, algorithm = 'sha1' } = typeof key === 'string' ? parseSetupKey(key) : key;
  const step = Math.floor(at / 1000 / period), counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac(algorithm, fromBase32(secret)).update(counter).digest(), o = mac.at(-1) & 15;
  const code = String((mac.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
  return { code, validFor: period - (Math.floor(at / 1000) % period) };
}
