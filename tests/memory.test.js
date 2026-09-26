// memory.js unit tests: spec 6.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelMemory } from '../src/engine/memory.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('memory: 8B Q4 16k single stream (T1 scenario)', () => {
  const m = modelMemory(config, { total_params_b: 8, bits_per_weight: 4.85, context_k: 16, streams: 1 });
  assert.ok(Math.abs(m.weights_gb - 4.85) < 1e-9, 'weights 4.85 GB');
  assert.ok(Math.abs(m.kv_gb_per_stream - 16 * (0.08 + 0.0035 * 8)) < 1e-9);
  assert.ok(Math.abs(m.required_gb - 7.378) < 0.01, 'required 7.38 GB, got ' + m.required_gb.toFixed(3));
});

test('memory: 32B Q4 8k matches spec T2 value 21.7 GB', () => {
  const m = modelMemory(config, { total_params_b: 32, bits_per_weight: 4.85, context_k: 8, streams: 1 });
  assert.ok(Math.abs(m.required_gb - 21.7) < 0.1);
});

test('memory: kv cache scales with streams', () => {
  const one = modelMemory(config, { total_params_b: 8, bits_per_weight: 4.85, context_k: 16, streams: 1 });
  const four = modelMemory(config, { total_params_b: 8, bits_per_weight: 4.85, context_k: 16, streams: 4 });
  assert.ok(Math.abs(four.kv_gb - one.kv_gb * 4) < 1e-9);
  assert.ok(Math.abs(four.required_gb - (one.required_gb + one.kv_gb_per_stream * 3)) < 1e-9);
});

test('memory: fp16 doubles weights vs q4', () => {
  const q4 = modelMemory(config, { total_params_b: 8, bits_per_weight: 4.85, context_k: 16, streams: 1 });
  const f16 = modelMemory(config, { total_params_b: 8, bits_per_weight: 16, context_k: 16, streams: 1 });
  assert.ok(Math.abs(f16.weights_gb - q4.weights_gb * (16 / 4.85)) < 1e-9);
});
