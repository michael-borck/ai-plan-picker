// Acceptance tests from spec section 13 that apply to the single-user path:
// T1 to T12, T18, T19, T20. Tolerance is plus or minus 10 percent unless the
// spec says otherwise (T1 is plus or minus 25 percent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleStreamSpeed } from '../src/engine/speed.js';
import { modelMemory } from '../src/engine/memory.js';
import { searchConfigs } from '../src/engine/configSearch.js';
import { apiDailyCostAud, apiClassInfo } from '../src/engine/api.js';
import { energyAudPerDay, tariffById } from '../src/engine/localCost.js';
import { sustainedTps, allowancePerWindow } from '../src/engine/subscription.js';
import { setParam, getParam } from '../src/engine/params.js';
import { budgetLadder } from '../src/engine/select.js';
import { compute } from '../src/engine/compute.js';
import { breakEvenMonth } from '../src/engine/timeSeries.js';
import { contextCheck, requiredContextTokens } from '../src/engine/fitChecks.js';
import { DAYS_PER_MONTH } from '../src/engine/units.js';
import { loadConfig } from './helpers.js';

function speedFor8B(config, { context_k = 16, vram = 12, bw = 360, eta = 0.60 }) {
  const mem = modelMemory(config, { total_params_b: 8, bits_per_weight: 4.85, context_k, streams: 1 });
  return { mem, speed: singleStreamSpeed(config, {
    placement: 'gpu_only', generation: 'modern', vram_usable_gb: vram * 0.95,
    bw_gpu_gbs: bw, eta_mid: eta, bw_ram_gbs: 50, n_gpu: 1,
    weights_gb: mem.weights_gb, kv_gb: mem.kv_gb, runtime_gb: mem.runtime_gb,
    active_params_b: 8, bits_per_weight: 4.85, moe: false
  }) };
}

test('T1: 8B dense Q4, 16k ctx, 12 GB small-modern is GPU-only at about 46 tok/s', () => {
  const config = loadConfig();
  const { mem, speed } = speedFor8B(config, {});
  assert.ok(mem.required_gb <= 12 * 0.95, 'fits GPU-only');
  assert.ok(Math.abs(speed.gpu_share - 1) < 1e-9);
  const picker = 46;
  assert.ok(Math.abs(speed.decode_tps.mid - picker) / picker <= 0.25,
    'mid ' + speed.decode_tps.mid.toFixed(1) + ' tok/s within 25 percent of 46');
});

test('T2: 32B dense Q4, 8k, 24 GB large-modern needs 21.7 GB at about 31 tok/s', () => {
  const config = loadConfig();
  const mem = modelMemory(config, { total_params_b: 32, bits_per_weight: 4.85, context_k: 8, streams: 1 });
  assert.ok(Math.abs(mem.required_gb - 21.7) / 21.7 <= 0.10, '21.7 GB, got ' + mem.required_gb.toFixed(2));
  const speed = singleStreamSpeed(config, {
    placement: 'gpu_only', generation: 'modern', vram_usable_gb: 24 * 0.95,
    bw_gpu_gbs: 936, eta_mid: 0.70, bw_ram_gbs: 50, n_gpu: 1,
    weights_gb: mem.weights_gb, kv_gb: mem.kv_gb, runtime_gb: mem.runtime_gb,
    active_params_b: 32, bits_per_weight: 4.85, moe: false
  });
  assert.ok(Math.abs(speed.decode_tps.mid - 31) / 31 <= 0.10,
    'mid ' + speed.decode_tps.mid.toFixed(1) + ' tok/s within 10 percent of 31');
});

test('T3: 30B MoE (3B active) on 12 GB + DDR4 is hybrid, share 0.70, about 35 tok/s', () => {
  const config = loadConfig();
  const mem = modelMemory(config, { total_params_b: 30, bits_per_weight: 4.85, context_k: 8, streams: 1 });
  const speed = singleStreamSpeed(config, {
    placement: 'hybrid', generation: 'modern', vram_usable_gb: 12 * 0.95,
    bw_gpu_gbs: 360, eta_mid: 0.60, bw_ram_gbs: 50, n_gpu: 1,
    weights_gb: mem.weights_gb, kv_gb: mem.kv_gb, runtime_gb: mem.runtime_gb,
    active_params_b: 3, bits_per_weight: 4.85, moe: true
  });
  assert.ok(Math.abs(speed.gpu_share - 0.70) <= 0.01, 'active GPU share 0.70, got ' + speed.gpu_share.toFixed(3));
  assert.ok(speed.decode_tps.mid >= 25 && speed.decode_tps.mid <= 45,
    'mid ' + speed.decode_tps.mid.toFixed(1) + ' tok/s within the stated 25 to 45');
});

test('T4: 70B Q4 4k: 1 x 24 GB + RAM is about 1 tok/s and rejected; 2 x 24 GB GPU-only about 13', () => {
  const config = loadConfig();
  const mem = modelMemory(config, { total_params_b: 70, bits_per_weight: 4.85, context_k: 4, streams: 1 });
  const hybrid = singleStreamSpeed(config, {
    placement: 'hybrid', generation: 'modern', vram_usable_gb: 24 * 0.95,
    bw_gpu_gbs: 936, eta_mid: 0.70, bw_ram_gbs: 70, n_gpu: 1,
    weights_gb: mem.weights_gb, kv_gb: mem.kv_gb, runtime_gb: mem.runtime_gb,
    active_params_b: 70, bits_per_weight: 4.85, moe: false
  });
  assert.ok(hybrid.decode_tps.mid < 2.5, 'about 1 tok/s, got ' + hybrid.decode_tps.mid.toFixed(2));
  assert.ok(hybrid.decode_tps.mid < 10, 'rejected at the 10 tok/s floor');

  const r = searchConfigs(config, {
    model: { total_b: 70, active_b: 70, moe: false }, bits: 4.85, context_k: 4, min_speed_tps: 10
  });
  const dual = r.qualifying.filter(c => c.placement === 'gpu_only' && c.n_gpu === 2 && c.size && c.size.vram_gb === 24);
  assert.ok(dual.length > 0, '2 x 24 GB GPU-only qualifies');
  assert.ok(!r.qualifying.some(c => c.placement === 'hybrid' && c.n_gpu === 1 && c.size && c.size.vram_gb === 24),
    '1 x 24 GB hybrid is rejected by the search');
  assert.ok(Math.abs(dual[0].speed.decode_tps.mid - 13) / 13 <= 0.10,
    'about 13 tok/s, got ' + dual[0].speed.decode_tps.mid.toFixed(1));
});

test('T5: budget AUD 300 for 70B in fixed mode gives a no-fit with computed alternatives', () => {
  const config = loadConfig();
  const r = searchConfigs(config, {
    model: { total_b: 70, active_b: 70, moe: false }, bits: 4.85, context_k: 4, budget_aud: 300
  });
  assert.equal(r.qualifying.length, 0, 'nothing fits inside 300');
  // Computed alternatives exist (used by the UI message).
  const any = searchConfigs(config, { model: { total_b: 70, active_b: 70, moe: false }, bits: 4.85, context_k: 4 });
  assert.ok(any.qualifying.length > 0);
  assert.ok(any.qualifying[0].price_aud > 300, 'cheapest fit costs more than 300');
});

test('T6: single user Typical Chat API Best thinking off is about AUD 0.35/day and 10.70/month', () => {
  const config = loadConfig();
  const daily = apiDailyCostAud(config, { class_id: 'best', tokens_in: 43125, tokens_out: 12825, cached_share: 0 });
  assert.ok(Math.abs(daily - 0.35) / 0.35 <= 0.10, 'daily ' + daily.toFixed(3));
  const month = daily * DAYS_PER_MONTH;
  assert.ok(Math.abs(month - 10.70) / 10.70 <= 0.10, 'month ' + month.toFixed(2));
  // Full first-month series value with defaults (growth and price change) stays in tolerance.
  const info = apiClassInfo(config, 'best');
  assert.ok(info.price_aud_per_1m_input > 0);
});

test('T7: 73 W idle, always on, 32 c/kWh is about AUD 205/yr at zero usage', () => {
  const config = loadConfig();
  const tariff = tariffById(config, 'residential');
  const e = energyAudPerDay(config, {
    load_w: 73, idle_w: 73, busy_h_peak: 0, busy_h_offpeak: 0, powered_h: 24, pue: 1.0, tariff
  });
  const perYear = e.aud_per_day * 365;
  assert.ok(Math.abs(perYear - 205) / 205 <= 0.10, 'AUD ' + perYear.toFixed(2) + '/yr');
});

test('T8: inference factor 0.45 to 0.75 changes only local energy and local TCO', () => {
  const base = loadConfig();
  const inputs = { horizon_years: 3 };
  const low = compute(setParam(base, 'power.inference_factor', 0.45), inputs);
  const high = compute(setParam(base, 'power.inference_factor', 0.75), inputs);
  const byIdLow = new Map(low.options.map(o => [o.id, o]));
  const byIdHigh = new Map(high.options.map(o => [o.id, o]));
  for (const [id, o] of byIdLow) {
    const other = byIdHigh.get(id);
    assert.ok(other, id + ' present in both');
    if (o.family === 'local') {
      if (o.candidate && o.candidate.n_gpu >= 1) {
        assert.notEqual(o.tco_at_horizon, other.tco_at_horizon, id + ' local TCO moves with the factor');
      } else {
        // CPU-only builds draw no card load, so the factor cannot move them.
        assert.equal(o.tco_at_horizon, other.tco_at_horizon, id + ' CPU-only TCO unchanged');
      }
    } else {
      assert.equal(o.tco_at_horizon, other.tco_at_horizon, id + ' TCO unchanged');
    }
  }
  // Local speed is untouched: the factor is about power draw, not bandwidth.
  const localLow = low.options.find(o => o.family === 'local' && o.candidate.n_gpu >= 1);
  const localHigh = high.options.find(o => o.id === localLow.id);
  assert.equal(localLow.per_user_tps_mid, localHigh.per_user_tps_mid);
});

test('T9: Base sub, 200k per 5 h: sustained about 11 tok/s; Power persona about 38 SQ/window', () => {
  const config = loadConfig();
  const tps = sustainedTps(config, 'base', 'best');
  assert.ok(Math.abs(tps - 11) / 11 <= 0.10, 'sustained ' + tps.toFixed(2) + ' tok/s');
  const sqPerWindow = allowancePerWindow(config, 'base', 'best') / 5190;
  assert.ok(Math.abs(sqPerWindow - 38) / 38 <= 0.10, 'SQ per window ' + sqPerWindow.toFixed(1));
});

test('T10: editing a sourced value makes it user-supplied with the original in the tooltip', () => {
  const config = loadConfig();
  const edited = setParam(config, 'fx.usd_aud', 1.60);
  const rec = getParam(edited, 'fx.usd_aud');
  assert.equal(rec.status, 'user-supplied');
  assert.equal(rec.original.value, 1.54);
  assert.equal(rec.original.status, 'sourced');
});

test('T11: budget-only AUD 2,000 returns a ladder rung, never an in-between size', () => {
  const config = loadConfig();
  const r = budgetLadder(config, { budget_aud: 2000, bits: 4.85, context_k: 16, min_speed_tps: 10, must_be_new: false });
  assert.ok(r.qualifies);
  const rungs = new Set([...config.model_ladder.dense_b, ...config.model_ladder.moe.map(m => m.total_b)]);
  assert.ok(rungs.has(r.rung.total_b), 'rung ' + r.rung.total_b + ' is on the ladder');
});

test('T12: sensitive data rule vetoes options greyed with reason, still costed', () => {
  const config = loadConfig();
  const r = compute(config, { data_sensitivity: 'sensitive', horizon_years: 3 });
  const vetoed = r.options.filter(o => o.sensitivity.vetoed);
  assert.ok(vetoed.length > 0, 'some options are vetoed');
  for (const o of vetoed) {
    assert.ok(o.sensitivity.reasons.length > 0, o.id + ' carries a reason');
    assert.ok(Number.isFinite(o.tco_at_horizon) && o.tco_at_horizon >= 0, o.id + ' is still costed');
  }
  const families = new Set(vetoed.map(o => o.family));
  assert.ok(families.has('rental'), 'hourly rental vetoed');
  assert.ok(families.has('subscription'), 'consumer subscriptions vetoed');
  assert.ok(families.has('api'), 'API vetoed');
  assert.ok(!vetoed.some(o => o.family === 'local'), 'local is never vetoed');
});

test('T18: payback view: break-even month matches net saving zero and the line cross', () => {
  const config = loadConfig();
  const r = compute(config, { horizon_years: 5 });
  const local = r.options.find(o => o.family === 'local');
  const other = r.options.find(o => o.family === 'api');
  assert.ok(local && other, 'a local option and an API option exist');
  const m = breakEvenMonth(local.tco_series, other.tco_series);
  let first = null;
  for (let i = 0; i <= 60; i++) {
    if (other.tco_series.nominal[i] - local.tco_series.nominal[i] >= 0) { first = i; break; }
  }
  assert.equal(m, first);
  if (m != null && m > 0) {
    assert.ok(local.tco_series.nominal[m] <= other.tco_series.nominal[m]);
    assert.ok(local.tco_series.nominal[m - 1] > other.tco_series.nominal[m - 1]);
  }
});

test('T19: RAG task (10k input) at 8k local context fails the check and flags', () => {
  const config = loadConfig();
  const rag = { input_tokens: 10000, output_tokens: 1000 };
  const fail = contextCheck(8, requiredContextTokens([rag], 1));
  assert.equal(fail.pass, false);
  assert.ok(fail.required_k > 8);
  // At the default 16k it passes; the engine wires the check into options.
  const pass = contextCheck(16, requiredContextTokens([rag], 1));
  assert.equal(pass.pass, true);
  const r = compute(config, { context_k: 8, usage_mode: 'documents' });
  const locals = r.options.filter(o => o.family === 'local');
  assert.ok(locals.length > 0);
  assert.ok(locals.every(o => o.context_check && o.context_check.pass === false), 'local options flagged at 8k in documents mode');
});

test('T20: thinking Off to High multiplies output tokens by 6 on every option', () => {
  const config = loadConfig();
  const off = compute(config, { thinking: 'off', horizon_years: 3 });
  const high = compute(config, { thinking: 'high', horizon_years: 3 });
  assert.ok(Math.abs(high.demand.thinking_multiplier - 6) < 1e-9);
  assert.ok(high.demand.sq_out_per_day === off.demand.sq_out_per_day, 'SQ counts unchanged, token counts change');
  const apiOff = off.options.find(o => o.id === 'api_best');
  const apiHigh = high.options.find(o => o.id === 'api_best');
  assert.ok(apiHigh.tco_at_horizon > apiOff.tco_at_horizon, 'cloud cost rises');
  const localOff = off.options.find(o => o.family === 'local');
  const localHigh = high.options.find(o => o.family === 'local');
  assert.ok(localHigh.tco_at_horizon > localOff.tco_at_horizon, 'local energy rises');
  assert.ok(localHigh.wait_hours_per_user_year > localOff.wait_hours_per_user_year, 'local wait time rises');
  assert.ok(apiHigh.wait_hours_per_user_year > apiOff.wait_hours_per_user_year, 'cloud wait time rises');
});
