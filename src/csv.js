/** Parse CSV text (quoted fields, doubled quotes, CRLF, a leading byte-order mark) into rows of cells. */
export function parseCsvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Rows as objects keyed by the header row. `headerHas` names a column that identifies the header line. */
export function parseCsv(text, headerHas) {
  const rows = parseCsvRows(text);
  const at = headerHas ? rows.findIndex((r) => r.some((c) => c.trim() === headerHas)) : 0;
  if (at < 0) return [];
  const head = rows[at].map((h) => h.trim());
  return rows.slice(at + 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
