// configSearch.js unit tests: spec 6.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchConfigs, resolvePlacement, cheapestFit } from '../src/engine/configSearch.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();
const MODEL = { total_b: 32, active_b: 32, moe: false };

test('search: finds a GPU-only config for 32B Q4 on 24 GB', () => {
  const r = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8 });
  const gpuOnly = r.qualifying.filter(c => c.placement === 'gpu_only');
  assert.ok(gpuOnly.length > 0);
  assert.ok(gpuOnly.every(c => c.price_aud > 0));
});

test('search: results are sorted cheapest first', () => {
  const r = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8 });
  for (let i = 1; i < r.qualifying.length; i++) {
    assert.ok(r.qualifying[i - 1].price_aud <= r.qualifying[i].price_aud);
  }
});

test('search: budget cap is respected', () => {
  const r = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8, budget_aud: 300 });
  assert.equal(r.qualifying.length, 0);
  assert.ok(r.near_misses.length >= 0);
});

test('search: must-be-new removes secondhand results', () => {
  const r = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8, must_be_new: true });
  assert.ok(r.qualifying.every(c => c.market === 'new' && c.band_market === 'new'));
});

test('search: single user path excludes server platforms', () => {
  const r = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8, allow_server: false });
  assert.ok(r.qualifying.every(c => !c.platform.server));
});

test('placement: classes follow the spec order GPU-only, hybrid, CPU-only, no fit', () => {
  const mem = { required_gb: 20 };
  const gpu = resolvePlacement(config, { platform: { kind: 'desktop' }, size: { vram_gb: 24 }, n_gpu: 1, ram_gb: 32, memory: mem });
  assert.equal(gpu.placement, 'gpu_only');
  const hyb = resolvePlacement(config, { platform: { kind: 'desktop' }, size: { vram_gb: 24 }, n_gpu: 1, ram_gb: 32, memory: { required_gb: 25 } });
  assert.equal(hyb.placement, 'hybrid');
  const cpu = resolvePlacement(config, { platform: { kind: 'desktop' }, size: { vram_gb: 24 }, n_gpu: 1, ram_gb: 64, memory: { required_gb: 85 } });
  assert.equal(cpu.placement, 'no_fit'); // 22.8 + 58 = 80.8 < 85
  const cpu2 = resolvePlacement(config, { platform: { kind: 'desktop' }, size: null, n_gpu: 0, ram_gb: 64, memory: { required_gb: 55 } });
  assert.equal(cpu2.placement, 'cpu_only');
});

test('placement: unified uses the addressable share of the pool', () => {
  const unified = config.platforms.find(p => p.kind === 'unified');
  const fit = resolvePlacement(config, { platform: unified, size: null, n_gpu: 0, ram_gb: 128, memory: { required_gb: 90 } });
  assert.equal(fit.placement, 'unified');
  assert.ok(Math.abs(fit.capacity_gb - 128 * 0.75) < 1e-9);
  const nofit = resolvePlacement(config, { platform: unified, size: null, n_gpu: 0, ram_gb: 128, memory: { required_gb: 100 } });
  assert.equal(nofit.placement, 'no_fit');
});

test('search: cheapest fit for 70B Q4 ignores budget and speed (T5 support)', () => {
  const fit = cheapestFit(config, { model: { total_b: 70, active_b: 70, moe: false }, bits: 4.85, context_k: 4 });
  assert.ok(fit, 'some configuration fits 70B');
  assert.ok(fit.price_aud > 300);
});

test('search: is deterministic', () => {
  const a = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8 });
  const b = searchConfigs(config, { model: MODEL, bits: 4.85, context_k: 8 });
  assert.deepEqual(a.qualifying.map(c => c.signature), b.qualifying.map(c => c.signature));
});
