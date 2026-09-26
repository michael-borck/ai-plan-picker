// recommend.js: filters, ranking, sensitivity rules, robustness sweep and
// recommendation text (spec 6.15).

import { setParam } from './params.js';

const SENSITIVITY_TAGS = {
  rental_hourly: 'hourly marketplace rental',
  rental_monthly: 'monthly rental',
  subscription_consumer: 'consumer subscription',
  api_non_enterprise: 'API access without enterprise terms',
  api_budget_offshore: 'budget offshore API'
};

// Sensitivity rules (spec 6.15): Sensitive vetoes hourly marketplace rental,
// consumer subscriptions and non-enterprise API, and flags monthly rental and
// budget-offshore API. Internal flags only. Public applies none.
// Vetoed options stay visible, greyed, with the reason, and remain costed.
export function applySensitivityRules(config, rule_id, option) {
  const rules = config.sensitivity_rules[rule_id] || config.sensitivity_rules.public;
  const veto = rules.veto || [];
  const flag = rules.flag || [];
  const tags = option.sensitivity_tags || [];
  const reasons = [];
  let vetoed = false;
  let flagged = false;
  for (const t of tags) {
    if (veto.includes(t)) {
      vetoed = true;
      reasons.push('Vetoed under the ' + rule_id + ' rule: ' + SENSITIVITY_TAGS[t] + ' may not hold sensitive data.');
    } else if (flag.includes(t)) {
      flagged = true;
      reasons.push('Flagged under the ' + rule_id + ' rule: ' + SENSITIVITY_TAGS[t] + ' needs review.');
    }
  }
  return { vetoed, flagged, reasons };
}

// Rank filtered options by TCO at horizon. Options already carry
// passes_filters. Returns winner and runner-up, or nulls.
export function rankOptions(options) {
  const passing = options.filter(o => o.passes_filters && !o.sensitivity.vetoed);
  const sorted = passing.slice().sort((a, b) => a.tco_at_horizon - b.tco_at_horizon);
  return { winner: sorted[0] || null, runner_up: sorted[1] || null, passing_count: passing.length };
}

// Banded envelope for the leading options (spec 7 chart 1): every listed
// parameter swung low together, then high together, so the chart can shade
// where the cumulative TCO of the winner and runner-up can plausibly land.
// Two extra computes, not one per parameter per end.
export function bandEnvelope(config, inputs, param_ids, computeFn, option_ids) {
  const run = end => {
    let cfg = config;
    for (const id of param_ids) {
      const rec = config.parameters[id];
      if (rec && rec.low !== rec.high) cfg = setParam(cfg, id, rec[end]);
    }
    return computeFn(cfg, { ...inputs, _skip_robustness: true });
  };
  const lowRun = run('low');
  const highRun = run('high');
  const pick = (result, id) => {
    const o = result.options.find(x => x.id === id);
    return o ? o.tco_series.nominal : null;
  };
  const out = {};
  for (const id of option_ids) {
    const low = pick(lowRun, id);
    const high = pick(highRun, id);
    if (!low || !high) continue;
    out[id] = { low, high };
  }
  return out;
}

// Sensitivity: swing each listed banded parameter to low and high one at a
// time and recompute once per end. Produces both the robustness verdict
// (spec 6.15: does the winner ever change?) and the tornado data (spec 7
// chart 8: how the winner-vs-runner-up TCO gap moves across each band).
export function sensitivityAnalysis(config, inputs, param_ids, computeFn) {
  const rows = [];
  const flips = [];
  const baseWinner = inputs._base_winner_id;
  // Chart ribbon tracker (spec 7 chart 1): per-month min/max of the
  // cumulative TCO for the leading options across every single-parameter
  // swing, seeded with their base series so the band brackets the lines.
  const bandOptionIds = inputs._band_option_ids || [];
  const bandBase = inputs._band_base_series || {};
  const envelope = {};
  for (const id of bandOptionIds) {
    if (bandBase[id]) envelope[id] = { low: bandBase[id].nominal.slice(), high: bandBase[id].nominal.slice() };
  }
  const absorb = result => {
    for (const id of bandOptionIds) {
      if (!envelope[id]) continue;
      const o = result.options.find(x => x.id === id);
      if (!o) continue;
      const nom = o.tco_series.nominal;
      for (let m = 0; m < nom.length; m++) {
        if (nom[m] < envelope[id].low[m]) envelope[id].low[m] = nom[m];
        if (nom[m] > envelope[id].high[m]) envelope[id].high[m] = nom[m];
      }
    }
  };
  for (const id of param_ids) {
    const rec = config.parameters[id];
    if (!rec || rec.low === rec.high) continue;
    const row = {
      param_id: id,
      label: rec.label,
      unit: rec.unit,
      low: rec.low,
      high: rec.high,
      base_gap: inputs._base_gap,
      low_gap: null,
      high_gap: null
    };
    for (const end of ['low', 'high']) {
      const swung = setParam(config, id, rec[end]);
      const result = computeFn(swung, { ...inputs, _skip_robustness: true });
      const rec2 = result.recommendation;
      const winnerId = rec2 && rec2.winner ? rec2.winner.id : null;
      if (winnerId !== baseWinner) {
        flips.push({ param_id: id, at: end, winner_id: winnerId });
      }
      const gap = rec2 && rec2.winner && rec2.runner_up
        ? rec2.winner.tco_at_horizon - rec2.runner_up.tco_at_horizon
        : null;
      row[end + '_gap'] = gap;
      if (result && result.options) absorb(result);
    }
    rows.push(row);
  }
  rows.sort((a, b) => swingOf(b) - swingOf(a));
  return { robust: flips.length === 0, flips, rows, envelopes: envelope };
}

function swingOf(row) {
  if (row.low_gap == null || row.high_gap == null || row.base_gap == null) return 0;
  return Math.max(Math.abs(row.low_gap - row.base_gap), Math.abs(row.high_gap - row.base_gap));
}

// Recommendation text follows the template in spec 6.15. Australian English,
// no em dashes (CLAUDE.md UI text conventions).
import { MONTHS_PER_YEAR } from './units.js';

export function formatRecommendation(config, inputs, { winner, runner_up, robustness }) {
  if (!winner) {
    return 'No option passes the filters for this scenario. Try a lower quality target, raise the budget, or relax the sensitivity rule.';
  }
  const preset = config.usage_presets.find(p => p.id === inputs.usage_preset);
  const presetLabel = preset ? preset.label : inputs.usage_preset;
  const mode = config.usage_modes.find(m => m.id === inputs.usage_mode);
  const modeLabel = mode ? mode.label : inputs.usage_mode;
  const target = config.quality_targets.find(t => t.id === inputs.quality_target);
  const targetLabel = target ? target.label : inputs.quality_target;

  const perUserPerMonth = winner.tco_at_horizon / (inputs.horizon_years * MONTHS_PER_YEAR);
  const parts = [];
  parts.push('For a single user, ' + presetLabel + ' usage, ' + modeLabel + ' mode, at ' + targetLabel +
    ' quality with ' + inputs.data_sensitivity + ' data, choose ' + winner.label + '.');
  if (runner_up) {
    parts.push('Over ' + inputs.horizon_years + ' years it costs about AUD ' + Math.round(winner.tco_at_horizon).toLocaleString('en-AU') +
      ' (about AUD ' + perUserPerMonth.toFixed(2) + ' per month), versus AUD ' + Math.round(runner_up.tco_at_horizon).toLocaleString('en-AU') +
      ' for ' + runner_up.label + '.');
    if (winner.break_even_vs_runner_up != null) {
      parts.push('Its cumulative TCO crosses ' + runner_up.label + ' at month ' + winner.break_even_vs_runner_up + '.');
    } else {
      parts.push('The cumulative TCO lines do not cross within 5 years.');
    }
  } else {
    parts.push('Over ' + inputs.horizon_years + ' years it costs about AUD ' + Math.round(winner.tco_at_horizon).toLocaleString('en-AU') +
      ' (about AUD ' + perUserPerMonth.toFixed(2) + ' per month). No other option passes the filters.');
  }
  parts.push('All figures are estimates.');
  if (robustness === null) {
    parts.push('Confidence check not run in this view.');
  } else if (robustness) {
    if (robustness.robust) {
      parts.push('Confidence: robust. The choice holds when parameters swing across their low and high bands.');
    } else {
      const names = robustness.flips.map(f => f.param_id + ' at its ' + f.at + ' value').join(', ');
      parts.push('Confidence: sensitive. The winner changes for ' + names + '.');
    }
  }
  parts.push(caveatFor(winner));
  return parts.join(' ');
}

function caveatFor(winner) {
  if (winner.family === 'subscription') {
    return 'Caveat: subscription allowances are not published and change often.';
  }
  if (winner.family === 'local' && winner.market === 'secondhand') {
    return 'Caveat: secondhand hardware carries no warranty and uncertain supply.';
  }
  if (winner.family === 'api') {
    return 'Caveat: API prices move fast; this is a dated snapshot.';
  }
  if (winner.family === 'rental') {
    return 'Caveat: rented capacity is billed per hour or month used, and data leaves the premises.';
  }
  return 'Caveat: every figure here is an estimate, not a measurement.';
}
