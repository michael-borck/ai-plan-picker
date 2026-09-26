// subscription.js: allowance, windows, weekly cap, sustained rate, burst
// speed, overflow and the 24-hour lockout simulation (spec 6.10, 11.7).
// The allowance is the least certain input in the model and is flagged
// wherever it is used.

import { pval } from './params.js';
import { SECONDS_PER_HOUR, SIM_STEPS_PER_HOUR, ONE, ZERO, SUM_EPSILON } from './units.js';

export function tierById(config, id) {
  const t = config.subscription_tiers.find(x => x.id === id);
  if (!t) throw new Error('Unknown subscription tier: ' + id);
  return t;
}

export function classMultiplier(config, cloud_class) {
  return pval(config, 'subscriptions.multiplier_' + cloud_class);
}

// allowance/window = base x tier multiplier x model-class multiplier.
// The Free tier ignores the class multiplier (docs/decisions.md D16): free
// tiers meter aggressively whatever model they serve.
export function allowancePerWindow(config, tier_id, cloud_class) {
  const tier = tierById(config, tier_id);
  const base = pval(config, 'subscriptions.base_allowance_tokens') * tier.allowance_multiplier;
  if (tier.ignore_class_multiplier) return base;
  return base * classMultiplier(config, cloud_class);
}

// Usable windows per day from the hours the seat is in use; unattended hours
// add windows when agents run through the subscription (spec 6.10).
export function windowsPerDay(config, { interactive_h, unattended_h }) {
  const windowH = pval(config, 'subscriptions.window_h');
  const hours = interactive_h + (unattended_h > ZERO ? unattended_h : ZERO);
  return Math.ceil(hours / windowH);
}

// capacity/day = min(allowance x windows, weekly_cap / days_per_week x allowance)
export function capacityPerDay(config, tier_id, cloud_class, { interactive_h, unattended_h, days_per_week }) {
  const allowance = allowancePerWindow(config, tier_id, cloud_class);
  const byWindows = allowance * windowsPerDay(config, { interactive_h, unattended_h });
  const byWeekly = allowance * pval(config, 'subscriptions.weekly_cap_windows') / days_per_week;
  return { capacity_tokens_per_day: Math.min(byWindows, byWeekly), by_windows: byWindows, by_weekly_cap: byWeekly, allowance_per_window: allowance };
}

// Sustained rate if the whole window is spent generating (total tokens).
export function sustainedTps(config, tier_id, cloud_class) {
  const allowance = allowancePerWindow(config, tier_id, cloud_class);
  return allowance / (pval(config, 'subscriptions.window_h') * SECONDS_PER_HOUR);
}

export function burstTps(config, cloud_class) {
  return pval(config, 'subscriptions.burst_tps_' + cloud_class);
}

export function ttftSeconds(config) {
  return pval(config, 'subscriptions.ttft_s');
}

// Demand profile over the interactive span in 5-minute steps (spec 14):
// a flat base plus a bump in the busiest hour sized by the peak-hour share.
export function spanStepWeights(config, { span_h, peak_share }) {
  const spanSteps = Math.max(ONE, Math.round(span_h * SIM_STEPS_PER_HOUR));
  const peakHourSteps = Math.max(ONE, Math.round(SIM_STEPS_PER_HOUR));
  const base = (ONE - peak_share) / spanSteps;
  const bump = peak_share / peakHourSteps;
  const peakStart = Math.floor(spanSteps / 2) - Math.floor(peakHourSteps / 2);
  const weights = [];
  for (let i = ZERO; i < spanSteps; i++) {
    let w = base;
    if (i >= peakStart && i < peakStart + peakHourSteps) w += bump;
    weights.push(w);
  }
  return weights;
}

// Front-load one window's demand into a short burst at the window start
// (docs/decisions.md D17): interactive work arrives in sessions, so a share
// of the window's tokens is consumed in a fraction of the window's time, then
// the user waits for reset. The transform preserves the chunk's total.
export function frontLoadChunk(chunk, timeShare, loadShare) {
  const len = chunk.length;
  let sum = ZERO;
  for (const v of chunk) sum += v;
  const burstSteps = Math.max(ONE, Math.round(len * timeShare));
  const burst = sum * loadShare / burstSteps;
  const tail = sum * (ONE - loadShare) / (len - burstSteps);
  const out = new Array(len);
  for (let i = ZERO; i < burstSteps; i++) out[i] = burst;
  for (let i = burstSteps; i < len; i++) out[i] = tail;
  return out;
}

function frontLoadSeries(series, stepsPerWindow, config) {
  const timeShare = pval(config, 'subscriptions.window_burst_time_share');
  const loadShare = pval(config, 'subscriptions.window_burst_load_share');
  const out = [];
  for (let start = ZERO; start < series.length; start += stepsPerWindow) {
    const chunk = series.slice(start, start + stepsPerWindow);
    for (const v of frontLoadChunk(chunk, timeShare, loadShare)) out.push(v);
  }
  return out;
}

export { frontLoadSeries };

// Simulate one usage day in 5-minute steps. Windows reset every window_h from
// the start of the span; each window's demand is front-loaded into a session
// burst (D17). Steps with no allowance left are lockout.
// Returns served tokens, lockout hours and coverage.
export function simulateSubscriptionDay(config, { allowance, span_h, tokens_per_day, peak_share }) {
  const windowH = pval(config, 'subscriptions.window_h');
  const weights = spanStepWeights(config, { span_h, peak_share });
  const stepsPerWindow = Math.max(ONE, Math.round(windowH * SIM_STEPS_PER_HOUR));
  const burstWeights = frontLoadSeries(weights, stepsPerWindow, config);
  const stepTokens = tokens_per_day;

  let budget = allowance;
  let served = ZERO;
  let lockedSteps = ZERO;
  let stepInWindow = ZERO;

  for (const w of burstWeights) {
    if (stepInWindow === stepsPerWindow) { // window boundary: reset
      budget = allowance;
      stepInWindow = ZERO;
    }
    const demand = w * stepTokens;
    const used = Math.min(budget, demand);
    served += used;
    budget -= used;
    if (demand > used) lockedSteps += ONE;
    stepInWindow += ONE;
  }

  const spanSteps = burstWeights.length;
  const rawCoverage = tokens_per_day > ZERO ? Math.min(ONE, served / tokens_per_day) : ONE;
  return {
    served_tokens: served,
    lockout_h_per_day: lockedSteps / SIM_STEPS_PER_HOUR,
    // Snap away floating-point dust so a fully served day counts as full
    // coverage (the front-loaded weights do not always sum to exactly one).
    coverage: rawCoverage > ONE - SUM_EPSILON ? ONE : rawCoverage,
    span_steps: spanSteps,
    steps_per_window: stepsPerWindow
  };
}
