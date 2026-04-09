'use strict';

// Output helpers. No ANSI colors: keeps the CLI dep-free and terminal-safe
// across Windows/CI. The secret banner uses blank lines and a `=` divider
// so it is impossible to miss in a scroll-back buffer.

const DIVIDER = '='.repeat(60);

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function printEntity(label, entity) {
  process.stdout.write(`${label}:\n`);
  const rows = [];
  for (const key of Object.keys(entity)) {
    const value = entity[key];
    rows.push([key, formatValue(value)]);
  }
  const keyWidth = rows.reduce((w, [k]) => Math.max(w, k.length), 0);
  for (const [k, v] of rows) {
    process.stdout.write(`  ${k.padEnd(keyWidth)}  ${v}\n`);
  }
}

function printList(label, items, summarize) {
  if (!items || items.length === 0) {
    process.stdout.write(`${label}: (none)\n`);
    return;
  }
  process.stdout.write(`${label} (${items.length}):\n`);
  for (const item of items) {
    process.stdout.write(`  - ${summarize(item)}\n`);
  }
}

function secretBanner(label, value, footnote) {
  process.stdout.write('\n' + DIVIDER + '\n');
  process.stdout.write(`  ${label} (shown once — store it now):\n\n`);
  process.stdout.write(`    ${value}\n\n`);
  if (footnote) process.stdout.write(`  ${footnote}\n`);
  process.stdout.write(DIVIDER + '\n');
}

function errorLine(err) {
  const code = err.code || 'error';
  const msg = err.message || String(err);
  process.stderr.write(`error: ${code} — ${msg}\n`);
  if (Array.isArray(err.details) && err.details.length > 0) {
    for (const d of err.details) {
      const path = d.path ? `${d.path}: ` : '';
      process.stderr.write(`  - ${path}${d.message}\n`);
    }
  }
}

function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.join(', ')}]`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

module.exports = {
  printJson,
  printEntity,
  printList,
  secretBanner,
  errorLine,
};
