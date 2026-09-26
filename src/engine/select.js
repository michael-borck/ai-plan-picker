// select.js: selection objectives, Budget-only ladders, quality-target mode,
// no-fit suggestions and the budget frontier (spec 6.4a, 4.2, chart 9).

import { searchConfigs, cheapestFit } from './configSearch.js';
import { effectiveSizeB } from './demand.js';
import { pval } from './params.js';
import { ZERO } from './units.js';

const ZERO_TPS = ZERO;
import { ONE } from './units.js';

// Model candidates for a quality target (spec 2.4): ladder rungs inside the
// dense range plus the target's MoE option.
export function modelCandidatesForTarget(config, target_id) {
  const t = config.quality_targets.find(x => x.id === target_id);
  if (!t) throw new Error('Unknown quality target: ' + target_id);
  const candidates = [];
  if (t.dense_b) {
    const rungs = config.model_ladder.dense_b.filter(b => b >= t.dense_b[0] && b <= t.dense_b[1]);
    for (const b of rungs) {
      candidates.push({ id: 'dense_' + b, label: b + 'B dense', total_b: b, active_b: b, moe: false, quality_target: target_id });
    }
  }
  if (t.moe_total_b) {
    candidates.push({
      id: 'moe_' + t.moe_total_b,
      label: t.moe_total_b + 'B MoE (' + t.moe_active_b + 'B active)',
      total_b: t.moe_total_b, active_b: t.moe_active_b, moe: true, quality_target: target_id
    });
  }
  return candidates;
}

// Budget-only mode: return a ladder rung, never an in-between size (T11).
// Rungs are tried largest effective size first; the largest rung that fits the
// budget and meets the minimum speed wins.
export function budgetLadder(config, { budget_aud, bits, context_k, min_speed_tps, must_be_new, streams }) {
  const rungs = [];
  for (const b of config.model_ladder.dense_b) {
    rungs.push({ id: 'dense_' + b, label: b + 'B dense', total_b: b, active_b: b, moe: false });
  }
  for (const m of config.model_ladder.moe) {
    rungs.push({ id: 'moe_' + m.total_b, label: m.total_b + 'B MoE (' + m.active_b + 'B active)', total_b: m.total_b, active_b: m.active_b, moe: true });
  }
  rungs.sort((a, b) => effectiveSizeB(b) - effectiveSizeB(a));

  const streamsSafe = streams != null ? streams : ONE;
  for (const rung of rungs) {
    const search = searchConfigs(config, {
      model: rung, bits, context_k, streams: streamsSafe,
      must_be_new, budget_aud, min_speed_tps
    });
    if (search.qualifying.length) {
      return { rung, chosen: search.qualifying[0], qualifies: true, search };
    }
  }
  return { rung: null, chosen: null, qualifies: false, search: null };
}

// No-fit suggestions (spec 6.4a): all four are computed, never static text.
// largest_fit: the biggest ladder rung that fits the budget at any speed;
// cheapest_fit: the budget that would run the model;
// best_available_tps: the fastest the budget manages for this model;
// moe_fit: the same-size MoE rung, cheaper to serve.
export function noFitAlternatives(config, { model, bits, context_k, streams, must_be_new, min_speed_tps, budget_aud }) {
  const anyFit = cheapestFit(config, { model, bits, context_k, streams, must_be_new });
  const fastFit = searchConfigs(config, { model, bits, context_k, streams, must_be_new, min_speed_tps }).qualifying[0] || null;
  let largestFit = null;
  if (budget_aud != null) {
    const rungs = [];
    for (const b of config.model_ladder.dense_b) rungs.push({ total_b: b, active_b: b, moe: false });
    for (const m of config.model_ladder.moe) rungs.push({ total_b: m.total_b, active_b: m.active_b, moe: true });
    for (const rung of rungs) {
      const search = searchConfigs(config, { model: rung, bits, context_k, streams, must_be_new, budget_aud });
      if (search.qualifying.length && (!largestFit || rung.total_b > largestFit.total_b)) largestFit = rung;
    }
  }
  let bestAvailableTps = ZERO_TPS;
  if (budget_aud != null) {
    const search = searchConfigs(config, { model, bits, context_k, streams, must_be_new, budget_aud });
    for (const c of search.qualifying) bestAvailableTps = Math.max(bestAvailableTps, c.speed.decode_tps.mid);
    for (const c of search.near_misses) {
      if (c.speed && c.speed.decode_tps) bestAvailableTps = Math.max(bestAvailableTps, c.speed.decode_tps.mid);
    }
  }
  let moeFit = null;
  if (!model.moe) {
    const tolerance = pval(config, 'explorer.moe_fit_tolerance');
    const candidate = config.model_ladder.moe
      .filter(m => Math.abs(m.total_b - model.total_b) / model.total_b < tolerance)
      .sort((a, b) => a.total_b - model.total_b)[0] || config.model_ladder.moe[0];
    const search = searchConfigs(config, {
      model: { id: 'moe_alt', total_b: candidate.total_b, active_b: candidate.active_b, moe: true },
      bits, context_k, streams, must_be_new, min_speed_tps
    });
    moeFit = search.qualifying[0] || null;
  }
  return {
    cheapest_fit: anyFit ? { signature: anyFit.signature, price_aud: anyFit.price_aud, placement: anyFit.placement } : null,
    cheapest_meeting_speed: fastFit ? { signature: fastFit.signature, price_aud: fastFit.price_aud, placement: fastFit.placement } : null,
    largest_fit_b: largestFit ? largestFit.total_b : null,
    best_available_tps: bestAvailableTps,
    moe_fit: moeFit ? { total_b: moeFit.model ? moeFit.model.total_b : null, price_aud: moeFit.price_aud } : null
  };
}



// Resolve the model for the Hardware explorer (spec 4.2):
// mode 'fixed' uses the given size; mode 'budget_only' takes the largest
// ladder rung that fits the budget at the minimum speed (never in-between).
export function explorerModel(config, explorer) {
  if (explorer.mode === 'budget_only') {
    const rung = budgetLadder(config, {
      budget_aud: explorer.budget_aud,
      bits: explorer.bits,
      context_k: explorer.context_k,
      min_speed_tps: explorer.min_speed_tps,
      must_be_new: explorer.must_be_new,
      streams: explorer.streams
    });
    return { model: rung.rung, via_ladder: true, ladder: rung };
  }
  return {
    model: { id: 'explorer_fixed', label: explorer.total_b + 'B ' + (explorer.moe ? 'MoE' : 'dense'),
      total_b: explorer.total_b, active_b: explorer.moe ? explorer.active_b : explorer.total_b, moe: explorer.moe },
    via_ladder: false
  };
}

// Pick the winning configuration for an objective (spec 4.2):
// 'fastest' = highest mid decode speed; 'cheapest' = lowest price that meets
// the minimum; 'best_value' = lowest price per tok/s of speed above the
// floor (docs/decisions.md D15).
export function chooseByObjective(config, qualifying, objective, min_speed_tps) {
  if (!qualifying || !qualifying.length) return null;
  if (objective === 'fastest') {
    return qualifying.slice().sort((a, b) => b.speed.decode_tps.mid - a.speed.decode_tps.mid)[0];
  }
  if (objective === 'best_value') {
    const scored = qualifying.map(c => ({
      cand: c,
      score: c.price_aud / Math.max(c.speed.decode_tps.mid - min_speed_tps, 1)
    }));
    scored.sort((a, b) => a.score - b.score);
    return scored[0].cand;
  }
  return qualifying[0]; // 'cheapest': search results are sorted by price
}

// Budget frontier (chart 9): for each budget from the configured minimum to
// maximum, the largest ladder rung runnable at the minimum speed, with the
// speed of the chosen configuration as the second series.
export function budgetFrontier(config, { bits, context_k, min_speed_tps, must_be_new, streams }) {
  const minBudget = pval(config, 'explorer.frontier_min_aud');
  const maxBudget = pval(config, 'explorer.frontier_max_aud');
  const points = pval(config, 'explorer.frontier_points');
  const rungs = [];
  for (const b of config.model_ladder.dense_b) {
    rungs.push({ id: 'dense_' + b, label: b + 'B dense', total_b: b, active_b: b, moe: false });
  }
  for (const m of config.model_ladder.moe) {
    rungs.push({ id: 'moe_' + m.total_b, label: m.total_b + 'B MoE (' + m.active_b + 'B active)', total_b: m.total_b, active_b: m.active_b, moe: true });
  }
  rungs.sort((a, b) => effectiveSizeB(a) - effectiveSizeB(b));

  // One search per rung: cheapest configuration meeting the speed floor.
  const perRung = rungs.map(rung => {
    const search = searchConfigs(config, {
      model: rung, bits, context_k, streams, must_be_new, min_speed_tps
    });
    const cheapest = search.qualifying[0] || null;
    return {
      rung,
      price_aud: cheapest ? cheapest.price_aud : null,
      tps_mid: cheapest ? cheapest.speed.decode_tps.mid : null
    };
  });

  const frontier = [];
  for (let p = ZERO; p <= points; p++) {
    const budget = minBudget + (maxBudget - minBudget) * p / points;
    let pick = null;
    for (const r of perRung) {
      if (r.price_aud != null && r.price_aud <= budget) pick = r;
    }
    frontier.push({
      budget_aud: budget,
      rung_label: pick ? pick.rung.label : null,
      effective_b: pick ? effectiveSizeB(pick.rung) : ZERO,
      tps_mid: pick ? pick.tps_mid : ZERO
    });
  }
  return { frontier, per_rung: perRung, min_budget: minBudget, max_budget: maxBudget };
}
