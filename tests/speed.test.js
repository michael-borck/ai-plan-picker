// speed.js unit tests: spec 6.4, 6.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleStreamSpeed, batchGain, batchedSpeeds, maxStreams } from '../src/engine/speed.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

function run(overrides) {
  return singleStreamSpeed(config, {
    placement: 'gpu_only', generation: 'modern', vram_usable_gb: 24 * 0.95,
    bw_gpu_gbs: 936, eta_mid: 0.70, bw_ram_gbs: 50, n_gpu: 1,
    weights_gb: 19.4, kv_gb: 1.536, runtime_gb: 0.8,
    active_params_b: 32, bits_per_weight: 4.85, moe: false,
    ...overrides
  });
}

test('speed: full GPU placement decode is bytes over eta times bandwidth', () => {
  const s = run({});
  assert.ok(Math.abs(s.gpu_share - 1) < 1e-9);
  // 19.4 GB / (0.70 x 936 GB/s) = 0.02961 s per token -> 33.79 tok/s
  assert.ok(Math.abs(s.decode_tps.mid - (0.7 * 936) / 19.4) < 1e-9);
});

test('speed: eta band produces low below mid below high', () => {
  const s = run({});
  assert.ok(s.decode_tps.low < s.decode_tps.mid);
  assert.ok(s.decode_tps.mid < s.decode_tps.high);
  assert.ok(Math.abs(s.decode_tps.low - s.decode_tps.mid / 1 / (0.85 / 1)) < 1e-6 || s.decode_tps.low < s.decode_tps.mid);
  assert.ok(Math.abs(s.decode_tps.low / s.decode_tps.mid - 0.85) < 1e-9);
  assert.ok(Math.abs(s.decode_tps.high / s.decode_tps.mid - 1.15) < 1e-9);
});

test('speed: prefill is decode times the placement multiplier', () => {
  const s = run({});
  assert.ok(Math.abs(s.prefill_tps.mid - s.decode_tps.mid * 20) < 1e-9);
  const legacy = run({ generation: 'legacy' });
  assert.ok(Math.abs(legacy.prefill_tps.mid - legacy.decode_tps.mid * 8) < 1e-9);
  const hybrid = run({ placement: 'hybrid', vram_usable_gb: 24 * 0.95 });
  assert.ok(Math.abs(hybrid.prefill_tps.mid - hybrid.decode_tps.mid * 6) < 1e-9);
});

test('speed: multi-GPU layer split applies the 0.90 factor', () => {
  const one = run({ n_gpu: 1 });
  const two = run({ n_gpu: 2 });
  assert.ok(Math.abs(two.decode_tps.mid / one.decode_tps.mid - 0.90) < 1e-9);
});

test('speed: MoE bonus only applies when a GPU path exists', () => {
  const hybrid = run({
    placement: 'hybrid', vram_usable_gb: 11.4, weights_gb: 18.19,
    kv_gb: 1.48, active_params_b: 3, moe: true, bw_gpu_gbs: 360, eta_mid: 0.60
  });
  assert.ok(Math.abs(hybrid.gpu_share - 0.70) < 0.01, 'share about 0.70, got ' + hybrid.gpu_share.toFixed(4));
  const cpuOnly = run({
    placement: 'cpu_only', vram_usable_gb: 0, weights_gb: 18.19,
    kv_gb: 1.48, active_params_b: 3, moe: true, bw_gpu_gbs: 360, eta_mid: 0.60
  });
  assert.ok(Math.abs(cpuOnly.gpu_share - 0) < 1e-9);
});

test('speed: batching G values match spec 6.5 (T14 values)', () => {
  assert.ok(Math.abs(batchGain(config, 1) - 1) < 1e-9);
  assert.ok(Math.abs(batchGain(config, 4) - 2.8) < 0.05, 'G(4) about 2.8, got ' + batchGain(config, 4).toFixed(2));
  assert.ok(Math.abs(batchGain(config, 8) - 3.9) < 0.05, 'G(8) about 3.9');
  assert.ok(Math.abs(batchGain(config, 16) - 4.9) < 0.1, 'G(16) about 4.9');
});

test('speed: per-user rate is aggregate over concurrency', () => {
  const s = run({});
  const b = batchedSpeeds(config, s, 4);
  assert.ok(Math.abs(b.gain - 2.8) < 0.05);
  assert.ok(Math.abs(b.per_user_tps.mid - s.decode_tps.mid * b.gain / 4) < 1e-9);
  assert.ok(Math.abs(b.aggregate_prefill_tps.mid - s.prefill_tps.mid) < 1e-9);
});

test('speed: max streams bounded by memory and speed floor', () => {
  const m = maxStreams(config, {
    vram_usable_gb: 22.8, weights_gb: 19.4, runtime_gb: 0.8,
    kv_gb_per_stream: 0.192, decode_mid_tps: 33.8, min_speed_tps: 10
  });
  assert.equal(m.by_memory, Math.floor((22.8 - 19.4 - 0.8) / 0.192));
  assert.equal(m.by_speed, 3);
  assert.ok(m.max <= Math.min(m.by_memory, m.by_speed));
});
