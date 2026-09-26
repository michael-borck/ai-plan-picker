// Wiring test: generalising T8. For each banded parameter, swinging it from
// low to high changes only the outputs that depend on it. Each case declares
// a "moves" predicate over options: options matching it must change, all
// others must not (membership and values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../src/engine/compute.js';
import { setParam } from '../src/engine/params.js';
import { loadConfig } from './helpers.js';

const DEFAULT_INPUTS = { horizon_years: 3 };

const CASES = [
  {
    id: 'power.inference_factor',
    // Card load scales with the factor; CPU-only builds draw no card load.
    moves: o => o.family === 'local' && o.candidate && o.candidate.n_gpu >= 1
  },
  {
    id: 'speed.eta_cpu',
    // The CPU path enters the speed model only when weights spill past the GPU.
    moves: o => o.family === 'local' && o.speed && o.speed.gpu_share < 1
  },
  {
    id: 'speed.layer_split_factor',
    // Only multi-card layer splits apply the factor; the High target is where
    // a 2 x 24 GB build qualifies in the single-user search.
    moves: o => o.family === 'local' && o.candidate && o.candidate.n_gpu >= 2,
    scenario: { quality_target: 'high' }
  },
  { id: 'fx.usd_aud', moves: o => o.family === 'rental' || o.id === 'broker_broker_credit' },
  { id: 'rental.sessions_per_day', moves: o => o.id.startsWith('rental_hourly') },
  { id: 'power.pue_single_user', moves: o => o.family === 'local' },
  { id: 'ownership.life_secondhand_years', moves: o => o.family === 'local' && o.market === 'secondhand' },
  { id: 'price_change.electricity_per_year', moves: o => o.family === 'local' },
  { id: 'api.previous_ratio', moves: o => o.id === 'api_previous' },
  {
    id: 'api.cached_share_documents',
    moves: o => o.family === 'api',
    scenario: { usage_mode: 'documents' }
  },
  {
    id: 'subscriptions.base_allowance_tokens',
    // Free and Base sit close enough to demand for the allowance to bind;
    // Pro and Max have slack, so their coverage cannot move.
    moves: o => o.id === 'sub_free' || o.id === 'sub_base',
    scenario: { persona: 'power', quality_target: 'high', thinking: 'high' }
  },
  {
    id: 'subscriptions.window_h',
    moves: o => o.id === 'sub_free' || o.id === 'sub_base',
    scenario: { persona: 'power', quality_target: 'high', thinking: 'high' }
  }
];

function snapshot(result) {
  const map = new Map();
  for (const o of result.options) {
    map.set(o.id, {
      family: o.family,
      tco: o.tco_at_horizon,
      coverage: o.coverage,
      tps: o.per_user_tps_mid,
      wait: o.wait_hours_per_user_year,
      cost_per_task: o.cost_per_task_aud
    });
  }
  return map;
}

function differs(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return a !== b;
  return Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

for (const c of CASES) {
  test('wiring: ' + c.id + ' low to high moves only dependent outputs', () => {
    const base = loadConfig();
    const rec = base.parameters[c.id];
    assert.ok(rec && rec.low !== rec.high, c.id + ' is banded');
    const low = compute(setParam(base, c.id, rec.low), { ...DEFAULT_INPUTS, ...c.scenario });
    const high = compute(setParam(base, c.id, rec.high), { ...DEFAULT_INPUTS, ...c.scenario });
    const a = snapshot(low);
    const b = snapshot(high);

    // Untouched families must keep identical membership.
    const idsA = [...a.keys()].filter(id => !c.moves(low.options.find(o => o.id === id))).sort();
    const idsB = [...b.keys()].filter(id => !c.moves(high.options.find(o => o.id === id))).sort();
    assert.deepEqual(idsA, idsB, 'untouched option membership unchanged');

    const union = new Set([...a.keys(), ...b.keys()]);
    let sawMove = false;
    for (const id of union) {
      const sa = a.get(id);
      const sb = b.get(id);
      const optLow = low.options.find(o => o.id === id);
      if (!sa || !sb) {
        // Membership changed: allowed only for options the parameter moves.
        assert.ok(c.moves(optLow || high.options.find(o => o.id === id)), id + ' membership change is a dependent option');
        sawMove = true;
        continue;
      }
      const changed = differs(sa.tco, sb.tco) || differs(sa.coverage, sb.coverage)
        || differs(sa.tps, sb.tps) || differs(sa.wait, sb.wait) || differs(sa.cost_per_task, sb.cost_per_task);
      if (c.moves(low.options.find(o => o.id === id))) {
        assert.ok(changed, id + ' should move with ' + c.id);
        sawMove = true;
      } else {
        assert.ok(!changed, id + ' should not move with ' + c.id);
      }
    }
    assert.ok(sawMove, c.id + ' moves at least one option');
  });
}

test('wiring: discount rate leaves nominal TCO unchanged but changes present value', () => {
  const base = loadConfig();
  const rec = base.parameters['discount.single_user'];
  const low = compute(setParam(base, 'discount.single_user', rec.low), DEFAULT_INPUTS);
  const high = compute(setParam(base, 'discount.single_user', rec.high), DEFAULT_INPUTS);
  let pvMoved = false;
  for (let i = 0; i < low.options.length; i++) {
    assert.equal(low.options[i].tco_series.nominal[60], high.options[i].tco_series.nominal[60]);
    if (low.options[i].tco_series.pv[60] !== high.options[i].tco_series.pv[60]) pvMoved = true;
  }
  assert.ok(pvMoved, 'present value moved');
});

test('wiring: compute is deterministic for identical inputs', () => {
  const base = loadConfig();
  const a = compute(base, DEFAULT_INPUTS);
  const b = compute(base, DEFAULT_INPUTS);
  assert.deepEqual(a.options.map(o => [o.id, o.tco_at_horizon]), b.options.map(o => [o.id, o.tco_at_horizon]));
  assert.equal(a.recommendation.winner.id, b.recommendation.winner.id);
});

test('wiring: config is never mutated by compute', () => {
  const base = loadConfig();
  const before = JSON.stringify(base.parameters['fx.usd_aud']);
  compute(base, { ...DEFAULT_INPUTS, data_sensitivity: 'sensitive' });
  assert.equal(JSON.stringify(base.parameters['fx.usd_aud']), before);
});
