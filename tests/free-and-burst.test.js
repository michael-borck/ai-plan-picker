// Free-tier realism and window burstiness (docs/decisions.md D16, D17).
// The user's scenario: the free tier must not absorb a full working day, and
// subscription windows must show reset waiting under bursty, iterative work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowancePerWindow, simulateSubscriptionDay, frontLoadChunk } from '../src/engine/subscription.js';
import { setParam } from '../src/engine/params.js';
import { compute } from '../src/engine/compute.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('free tier ignores the model-class allowance multiplier (D16)', () => {
  assert.equal(allowancePerWindow(config, 'free', 'cheap'), 20000, '20k tokens regardless of class');
  assert.equal(allowancePerWindow(config, 'free', 'best'), 20000);
  // Paid tiers still take the class multiplier.
  assert.equal(allowancePerWindow(config, 'base', 'cheap'), 800000);
});

test('free tier cannot absorb a Typical working day on its own', () => {
  // CR-001: the free tier is no longer excluded for it. Its own share is
  // well below one, the shortfall is topped up and priced, so it competes
  // honestly instead of being dismissed.
  const r = compute(config, { persona: 'typical', quality_target: 'good', horizon_years: 3 });
  const free = r.options.find(o => o.id === 'sub_free');
  assert.ok(free.own_share < 1, 'own share ' + free.own_share.toFixed(2));
  assert.ok(free.topup_monthly_aud > 0, 'the shortfall is topped up and priced');
  assert.equal(free.completed_fraction, 1, 'with top-up the week completes');
  assert.ok(free.tco_at_horizon > 0, 'the top-up shows up in the TCO');
  assert.ok(free.lockout_h_per_day > 0, 'reset waiting still shows: ' + free.lockout_h_per_day.toFixed(1));
});

test('free tier is enough for a light user', () => {
  const r = compute(config, { persona: 'light', quality_target: 'good', horizon_years: 3 });
  const free = r.options.find(o => o.id === 'sub_free');
  assert.equal(free.coverage, 1);
  assert.equal(free.lockout_h_per_day, 0);
  assert.equal(r.recommendation.winner.id, 'sub_free', 'a light user genuinely fits the free tier');
});

test('front-load transform preserves the window total', () => {
  const chunk = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = frontLoadChunk(chunk, 0.2, 0.6);
  const sumIn = chunk.reduce((a, b) => a + b, 0);
  const sumOut = out.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumIn - sumOut) < 1e-9);
  assert.ok(out[0] > out[out.length - 1], 'front steps are heavier than tail steps');
});

test('burstiness lengthens lockout when the allowance is tight', () => {
  const scenario = { allowance: 120000, span_h: 8, tokens_per_day: 200000, peak_share: 0.2 };
  const smooth = simulateSubscriptionDay(setParam(setParam(config, 'subscriptions.window_burst_load_share', 0.4), 'subscriptions.window_burst_time_share', 0.4), scenario);
  const bursty = simulateSubscriptionDay(setParam(setParam(config, 'subscriptions.window_burst_load_share', 0.9), 'subscriptions.window_burst_time_share', 0.1), scenario);
  assert.ok(bursty.lockout_h_per_day >= smooth.lockout_h_per_day,
    'bursty ' + bursty.lockout_h_per_day + ' vs smooth ' + smooth.lockout_h_per_day);
  assert.ok(bursty.lockout_h_per_day > 0, 'a tight allowance produces real reset waiting');
  // Coverage is unaffected by the shape: the same tokens are served overall.
  assert.ok(Math.abs(bursty.served_tokens - smooth.served_tokens) < 1e-6);
});
