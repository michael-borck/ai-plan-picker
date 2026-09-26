// subscription.js unit tests: spec 6.10, 11.7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowancePerWindow, windowsPerDay, capacityPerDay, sustainedTps,
  burstTps, simulateSubscriptionDay, spanStepWeights, tierById
} from '../src/engine/subscription.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('subscription: base tier on Best holds 200k tokens per 5 h window', () => {
  assert.equal(allowancePerWindow(config, 'base', 'best'), 200000);
});

test('subscription: tier multipliers apply (pro 5x, max 20x, free 0.1x)', () => {
  assert.equal(allowancePerWindow(config, 'pro', 'best'), 1000000);
  assert.equal(allowancePerWindow(config, 'max', 'best'), 4000000);
  assert.equal(allowancePerWindow(config, 'free', 'best'), 20000);
});

test('subscription: class multipliers apply on top (cheap 4x)', () => {
  assert.equal(allowancePerWindow(config, 'base', 'cheap'), 800000);
});

test('subscription: sustained rate is allowance over the window (T9: about 11 tok/s)', () => {
  const tps = sustainedTps(config, 'base', 'best');
  assert.ok(Math.abs(tps - 200000 / (5 * 3600)) < 1e-9);
  assert.ok(Math.abs(tps - 11.11) < 0.11);
});

test('subscription: T9 power persona fits about 38 SQ in a window', () => {
  const sq = allowancePerWindow(config, 'base', 'best') / 5190;
  assert.ok(Math.abs(sq - 38.5) < 3.9, 'expected about 38, got ' + sq.toFixed(1));
});

test('subscription: windows come from the span, unattended adds when agents run', () => {
  assert.equal(windowsPerDay(config, { interactive_h: 8, unattended_h: 0 }), 2);
  assert.equal(windowsPerDay(config, { interactive_h: 8, unattended_h: 10 }), 4);
});

test('subscription: capacity is the lesser of windows and the weekly cap', () => {
  const cap = capacityPerDay(config, 'base', 'best', { interactive_h: 8, unattended_h: 0, days_per_week: 5 });
  assert.equal(cap.by_windows, 400000);
  assert.ok(Math.abs(cap.by_weekly_cap - 200000 * 12 / 5) < 1e-9);
  assert.equal(cap.capacity_tokens_per_day, Math.min(cap.by_windows, cap.by_weekly_cap));
  // Extended: 12 h span gives 3 windows but the weekly cap binds.
  const ext = capacityPerDay(config, 'base', 'best', { interactive_h: 12, unattended_h: 0, days_per_week: 6 });
  assert.equal(ext.capacity_tokens_per_day, 400000);
});

test('subscription: burst speeds by class (best 60, previous 80, cheap 150)', () => {
  assert.equal(burstTps(config, 'best'), 60);
  assert.equal(burstTps(config, 'previous'), 80);
  assert.equal(burstTps(config, 'cheap'), 150);
});

test('subscription: step weights sum to one and concentrate the peak share', () => {
  const w = spanStepWeights(config, { span_h: 8, peak_share: 0.2 });
  const sum = w.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const stepsPerHour = w.length / 8;
  // The bump spans one hour of steps centred on the middle of the span.
  const peakStart = Math.floor(w.length / 2) - Math.floor(stepsPerHour / 2);
  const peakSum = w.slice(peakStart, peakStart + stepsPerHour).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(peakSum - 0.3) < 0.02, 'peak hour carries its share plus the bump, got ' + peakSum.toFixed(3));
  assert.ok(stepsPerHour > 0);
});

test('subscription: sim serves all tokens when demand fits the first window', () => {
  const sim = simulateSubscriptionDay(config, {
    allowance: 200000, span_h: 8, tokens_per_day: 100000, peak_share: 0.2
  });
  assert.ok(Math.abs(sim.coverage - 1) < 1e-9, 'coverage 1, got ' + sim.coverage);
  assert.equal(sim.lockout_h_per_day, 0);
});

test('subscription: sim reports lockout when a window runs dry', () => {
  const sim = simulateSubscriptionDay(config, {
    allowance: 100000, span_h: 10, tokens_per_day: 400000, peak_share: 0.2
  });
  assert.ok(sim.lockout_h_per_day > 0, 'expected lockout');
  assert.ok(sim.coverage < 1 && sim.coverage > 0);
  assert.ok(Math.abs(sim.served_tokens - 200000) < 1e-6, 'two full windows in a 10 h span');
});

test('subscription: enterprise tier exists for the business tabs', () => {
  const t = tierById(config, 'enterprise');
  assert.equal(t.allowance_multiplier, 5);
  assert.equal(t.seat_aud_month, 92.40);
});
