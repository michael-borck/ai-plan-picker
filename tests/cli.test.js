// CLI tests: the command line runs the real engine and produces the four
// formats plus the sweep (Phase C).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'comparator.js');

function run(args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
}

test('cli: default one-line recommendation', () => {
  const out = run([]);
  assert.ok(out.startsWith('Choose '), out.slice(0, 80));
  assert.ok(out.includes('over 3 years'));
});

test('cli: table format lists options and the advice', () => {
  const out = run(['--format', 'table', '--persona', 'power', '--usage_mode', 'agentic']);
  assert.ok(out.includes('Broker free'), out.slice(0, 200));
  assert.ok(out.includes('own%'));
  assert.ok(out.includes('Recommendation') || out.includes('choose') || out.includes('Choose'));
});

test('cli: markdown format is a report with tables', () => {
  const out = run(['--format', 'markdown', '--horizon', '5']);
  assert.ok(out.startsWith('# AI plan picker report'));
  assert.ok(out.includes('| Option | Upfront |'));
  assert.ok(out.includes('## Sensitivity'));
  assert.ok(out.includes('5-year horizon'));
});

test('cli: json format parses and carries the grid and tornado', () => {
  const out = run(['--format', 'json']);
  const parsed = JSON.parse(out);
  assert.ok(parsed.options.length >= 12);
  assert.ok(parsed.options[0].task_cells.length === 7);
  assert.ok(Array.isArray(parsed.tornado) && parsed.tornado.length > 0);
  assert.ok(parsed.recommendation.winner);
});

test('cli: config file applies parameter edits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'app-picker-'));
  const cfgFile = path.join(dir, 'config.json');
  const base = JSON.parse(readFileSync(path.join(ROOT, 'src', 'defaults.json'), 'utf8'));
  const exported = {
    kind: 'ai-delivery-comparator-config',
    version: 1,
    parameters: {
      'fx.usd_aud': { value: 1.60, status: 'user-supplied', original: { value: 1.54, status: 'sourced' } }
    }
  };
  writeFileSync(cfgFile, JSON.stringify(exported));
  const out = run(['--config', cfgFile, '--format', 'json']);
  const parsed = JSON.parse(out);
  // The rental options move with FX, so a changed rate must change the numbers
  const withDefault = JSON.parse(run(['--format', 'json']));
  const rentalA = parsed.options.find(o => o.family === 'rental');
  const rentalB = withDefault.options.find(o => o.family === 'rental');
  assert.notEqual(rentalA.tco_at_horizon, rentalB.tco_at_horizon, 'FX edit changed rental TCO');
});

test('cli: sweep produces the persona by mode grid', () => {
  const out = run(['--sweep']);
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 10, 'header plus nine combinations');
  assert.ok(lines[1].startsWith('light,chat,'));
  assert.ok(lines[9].startsWith('power,agentic,'));
});
