// Bundle regression: dist/comparator.html must execute end to end with a
// stubbed DOM and a stubbed Chart. This catches engine modules missing from
// build.js ENGINE_ORDER and wiring errors that only appear in the browser
// (the blank-charts incident: profile24.js was missing from the bundle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'comparator.html');

class ChartStub {
  constructor(ctx, config) { this.config = config; ChartStub.created.push(config); }
  destroy() {}
  update() {}
}
ChartStub.created = [];

function stubEl(tag) {
  return {
    tagName: tag, innerHTML: '', textContent: '', value: '', checked: false,
    min: 0, max: 0, step: 1, options: [], selectedIndex: 0, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, setAttribute() {},
    querySelectorAll(sel) { return sel === 'button' ? [stubEl('button'), stubEl('button')] : []; },
    querySelector(sel) { return sel === 'select' ? stubEl('select') : null; },
    getContext() { return {}; },
    dataset: {}
  };
}

function runBundle() {
  const html = readFileSync(DIST, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 3, 'three script blocks: vendor, config, app');

  const sandbox = {
    console,
    document: {
      _els: new Map(),
      getElementById(id) {
        if (!this._els.has(id)) this._els.set(id, stubEl('div'));
        return this._els.get(id);
      },
      createElement: t => stubEl(t),
      querySelectorAll: () => [],
      body: { classList: { toggle() {}, add() {}, remove() {} } }
    },
    history: { replaceState() {} },
    location: { hash: '', search: '' },
    localStorage: { setItem() {}, getItem() { return null; } },
    Chart: ChartStub
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scripts[1], sandbox, { filename: 'config.js' });
  vm.runInContext(scripts[2], sandbox, { filename: 'app.js' });
  return sandbox;
}

test('bundle boots with a stubbed Chart and every chart renderer executes', () => {
  assert.ok(existsSync(DIST), 'dist/comparator.html exists: run node build.js first');
  ChartStub.created = [];
  const sandbox = runBundle();
  assert.equal(typeof sandbox.compute, 'function', 'compute is global in the bundle');

  const result = sandbox.compute(sandbox.window.__COMPARE_CONFIG__, { horizon_years: 3 });
  assert.ok(result.options.length >= 10);
  assert.ok(Array.isArray(result.tornado) && result.tornado.length > 0, 'tornado rows present');
  assert.ok(sandbox.Chart.created.length >= 4,
    'tco, profile, wait, capacity and tornado charts all got configs, got ' + sandbox.Chart.created.length);
  const titles = sandbox.Chart.created.map(c => c.options && c.options.plugins && c.options.plugins.title && c.options.plugins.title.text);
  assert.ok(titles.some(t => /Cumulative TCO/.test(t || '')), 'TCO chart rendered');
  assert.ok(titles.some(t => /24-hour/.test(t || '')), 'profile chart rendered');
  assert.ok(titles.some(t => /Waiting time/.test(t || '')), 'waiting chart rendered');
  assert.ok(titles.some(t => /Capacity versus demand/.test(t || '')), 'capacity chart rendered');
});
