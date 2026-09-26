// No-magic-numbers: engine modules (except units.js) may only contain the
// numeric literals 0, 1, 2 and 100. Unit conversions live in units.js
// (CLAUDE.md architecture rules). Comments and strings are stripped before
// scanning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENGINE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engine');
const ALLOWED = new Set(['0', '1', '2', '100']);

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | single | double | template
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (ch === "'") { mode = 'single'; i++; continue; }
      if (ch === '"') { mode = 'double'; i++; continue; }
      if (ch === '`') { mode = 'template'; i++; continue; }
      out += ch; i++; continue;
    }
    if (mode === 'line') { if (ch === '\n') { mode = 'code'; out += ch; } i++; continue; }
    if (mode === 'block') { if (ch === '*' && next === '/') { mode = 'code'; i += 2; continue; } i++; continue; }
    if (mode === 'single') { if (ch === '\\') { i += 2; continue; } if (ch === "'") { mode = 'code'; } i++; continue; }
    if (mode === 'double') { if (ch === '\\') { i += 2; continue; } if (ch === '"') { mode = 'code'; } i++; continue; }
    if (mode === 'template') { if (ch === '\\') { i += 2; continue; } if (ch === '`') { mode = 'code'; } i++; continue; }
  }
  return out;
}

test('no magic numbers: engine files contain only 0, 1, 2 and 100', () => {
  const files = readdirSync(ENGINE_DIR).filter(f => f.endsWith('.js') && f !== 'units.js');
  assert.ok(files.length >= 10, 'engine files found: ' + files.join(', '));
  const offenders = [];
  for (const f of files) {
    const src = stripCommentsAndStrings(readFileSync(path.join(ENGINE_DIR, f), 'utf8'));
    const re = /\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const lit = m[0];
      if (!ALLOWED.has(lit)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(f + ':' + line + ' -> ' + lit);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('units.js exports the conversion constants the engine is allowed to use', async () => {
  const units = await import('../src/engine/units.js');
  for (const key of ['SECONDS_PER_HOUR', 'HOURS_PER_DAY', 'DAYS_PER_WEEK', 'WEEKS_PER_YEAR',
    'MONTHS_PER_YEAR', 'DAYS_PER_YEAR', 'HORIZON_MONTHS_MAX', 'WATTS_PER_KILOWATT',
    'TOKENS_PER_MILLION', 'BITS_PER_BYTE', 'HUNDRED']) {
    assert.ok(key in units, key + ' exists');
  }
});
