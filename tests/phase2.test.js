// profile24.js, budget frontier and explorer selection tests, and value-of-
// time costing. Spec 7 charts 4 and 9, spec 4.2, spec 2.7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demand24, delivered24, profile24 } from '../src/engine/profile24.js';
import { budgetFrontier, explorerModel, chooseByObjective, budgetLadder } from '../src/engine/select.js';
import { searchConfigs } from '../src/engine/configSearch.js';
import { compute } from '../src/engine/compute.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();
const STEPS = 24 * 12; // 5-minute steps

test('profile: demand sums to the interactive and agent token totals', () => {
  const d = demand24(config, { tokens_interactive: 100000, tokens_agent: 50000, span_h: 8, unattended_h: 10, peak_share: 0.2 });
  assert.equal(d.length, STEPS);
  const total = d.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 150000) < 0.01);
});

test('profile: no demand outside span when no agents', () => {
  const d = demand24(config, { tokens_interactive: 100000, tokens_agent: 0, span_h: 8, unattended_h: 0, peak_share: 0.2 });
  const inSpan = d.slice(0, 8 * 12).reduce((a, b) => a + b, 0);
  const outside = d.slice(8 * 12).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(inSpan - 100000) < 0.01);
  assert.equal(outside, 0);
});

test('profile: local delivers at its rate and carries backlog overnight', () => {
  const d = demand24(config, { tokens_interactive: 2000000, tokens_agent: 0, span_h: 8, unattended_h: 0, peak_share: 0.2 });
  const r = delivered24(config, { kind: 'local', demand: d, rate_tps: 20 });
  const delivered = r.delivered.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(delivered - 20 * 300 * STEPS) < 1e-6, 'rate x step seconds x steps');
  assert.ok(r.backlog_tokens > 0, 'demand beyond the daily rate leaves backlog at midnight');
});

test('profile: subscription lockout appears when the window runs dry', () => {
  const d = demand24(config, { tokens_interactive: 900000, tokens_agent: 0, span_h: 10, unattended_h: 0, peak_share: 0.2 });
  const r = delivered24(config, { kind: 'subscription', demand: d, allowance: 200000, window_h: 5, burst_tps: 60 });
  const delivered = r.delivered.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(delivered - 400000) < 1e-6, 'two windows of allowance');
  assert.ok(r.locked.some(Boolean), 'some steps are locked out');
});

test('profile: api delivers what the burst cap allows, effectively all demand', () => {
  const d = demand24(config, { tokens_interactive: 60000, tokens_agent: 0, span_h: 8, unattended_h: 0, peak_share: 0.2 });
  const r = delivered24(config, { kind: 'api', demand: d, burst_tps: 150 });
  const demand = d.reduce((a, b) => a + b, 0);
  const delivered = r.delivered.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(delivered - demand) < 1e-6, '60k tokens over 8h never hits 150 tok/s');
});

test('profile: convenience wrapper returns cumulative series', () => {
  const p = profile24(config,
    { tokens_interactive: 100000, tokens_agent: 0, span_h: 8, unattended_h: 0, peak_share: 0.2 },
    { kind: 'local', rate_tps: 30 });
  assert.ok(p.demand.length === STEPS && p.delivered.length === STEPS);
  assert.ok(Math.abs(p.demand_total - 100000) < 0.01);
  assert.ok(p.demand[p.demand.length - 1] > 0);
});

// ---- budget frontier (chart 9) ----

test('frontier: rung labels come from the ladder and grow with budget', () => {
  const f = budgetFrontier(config, { bits: 4.85, context_k: 16, min_speed_tps: 10, must_be_new: false });
  const ladderTotals = new Set([...config.model_ladder.dense_b, ...config.model_ladder.moe.map(m => m.total_b)]);
  for (const point of f.frontier) {
    if (point.rung_label) {
      const total = Number(point.rung_label.split('B')[0]);
      assert.ok(ladderTotals.has(total), point.rung_label + ' is a rung');
    }
  }
  // Monotonic: the runnable size never shrinks as budget rises.
  let last = 0;
  for (const point of f.frontier) {
    assert.ok(point.effective_b >= last);
    last = point.effective_b;
  }
  const lastPoint = f.frontier[f.frontier.length - 1];
  assert.ok(lastPoint.effective_b > f.frontier[0].effective_b, 'the top budget runs a bigger model than the bottom');
  assert.ok(lastPoint.tps_mid >= 10, 'frontier picks meet the speed floor');
});

// ---- explorer model and objective (spec 4.2) ----

test('explorer: budget-only mode returns a ladder rung, fixed mode the given size', () => {
  const budgetOnly = explorerModel(config, {
    mode: 'budget_only', budget_aud: 2000, bits: 4.85, context_k: 16, min_speed_tps: 10,
    must_be_new: false, streams: 1
  });
  assert.ok(budgetOnly.via_ladder && budgetOnly.model, 'budget-only resolves a rung');
  const fixed = explorerModel(config, {
    mode: 'fixed', total_b: 14, active_b: 14, moe: false,
    bits: 4.85, context_k: 16, min_speed_tps: 10, must_be_new: false, streams: 1
  });
  assert.equal(fixed.model.total_b, 14);
  assert.ok(!fixed.via_ladder);
});

test('explorer: fastest objective picks a faster machine than cheapest', () => {
  const search = searchConfigs(config, {
    model: { total_b: 32, active_b: 32, moe: false }, bits: 4.85, context_k: 16, min_speed_tps: 10
  });
  const cheapest = chooseByObjective(config, search.qualifying, 'cheapest', 10);
  const fastest = chooseByObjective(config, search.qualifying, 'fastest', 10);
  assert.ok(fastest.speed.decode_tps.mid >= cheapest.speed.decode_tps.mid);
  assert.ok(fastest.price_aud >= cheapest.price_aud);
});

// ---- value of time (spec 2.7) ----

test('value of time: costed waiting enters TCO for every option present in both runs', () => {
  const base = loadConfig();
  const off = compute(base, { persona: 'power', quality_target: 'good', horizon_years: 3 });
  const vot = 25;
  const on = compute(base, { persona: 'power', quality_target: 'good', horizon_years: 3, value_of_time_aud_h: vot });
  // With waiting costed the local shortlist can change membership, so compare
  // the options that exist in both runs.
  let compared = 0;
  for (const a of off.options) {
    const b = on.options.find(o => o.id === a.id);
    if (!b) continue;
    compared++;
    const base = a.wait_hours_per_user_year * vot / 12 * 36;
    const delta = b.tco_at_horizon - a.tco_at_horizon;
    // Top-up hours can add to the wait itself (spec 6.11a), so the gain is at
    // least the off-run wait times the rate.
    assert.ok(delta >= base - 0.5, a.id + ' gains at least ' + base.toFixed(2) + ', got ' + delta.toFixed(2));
  }
  assert.ok(compared >= 8, 'most options persist across the runs, compared ' + compared);
});

test('value of time: the best local build becomes a fast one, not the cheapest', () => {
  const base = loadConfig();
  const off = compute(base, { persona: 'power', quality_target: 'good', horizon_years: 3 });
  const on = compute(base, { persona: 'power', quality_target: 'good', horizon_years: 3, value_of_time_aud_h: 25 });
  const bestLocal = r => r.options.filter(o => o.family === 'local')
    .slice().sort((a, b) => a.tco_at_horizon - b.tco_at_horizon)[0];
  const offLocal = bestLocal(off);
  const onLocal = bestLocal(on);
  assert.ok(offLocal.per_user_tps_mid < onLocal.per_user_tps_mid,
    'with time costed the chosen local box is faster: ' + offLocal.per_user_tps_mid + ' -> ' + onLocal.per_user_tps_mid);
  assert.ok(onLocal.wait_hours_per_user_year < offLocal.wait_hours_per_user_year,
    'and waits less: ' + onLocal.wait_hours_per_user_year + ' < ' + offLocal.wait_hours_per_user_year);
});

test('explorer: compute uses the explorer build when active', () => {
  const base = loadConfig();
  const r = compute(base, {
    horizon_years: 3,
    explorer: { active: true, mode: 'fixed', budget_aud: 'auto', total_b: 14, active_b: 14, moe: false, market: 'either', objective: 'cheapest' }
  });
  assert.ok(r.explorer, 'explorer pick recorded');
  assert.equal(r.explorer.model.total_b, 14);
  const local = r.options.filter(o => o.family === 'local');
  assert.equal(local.length, 1, 'explorer replaces the quality-target shortlist');
  assert.equal(local[0].model.total_b, 14);
});
