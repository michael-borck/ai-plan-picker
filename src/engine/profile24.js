// profile24.js: 24-hour delivery profile (spec 7 chart 4, spec 14).
// Cumulative demand vs delivered tokens in 5-minute steps: subscription
// burst, plateau and reset (lockout visible), local steady and continuing
// overnight, API effectively tracks demand.

import { pval } from './params.js';
import { SIM_STEP_MINUTES, SIM_STEPS_PER_HOUR, SECONDS_PER_MINUTE, HOURS_PER_DAY, ZERO, ONE } from './units.js';
import { spanStepWeights, frontLoadSeries } from './subscription.js';

const STEP_SECONDS = SIM_STEP_MINUTES * SECONDS_PER_MINUTE;

function cumulative(series) {
  const out = [];
  let sum = ZERO;
  for (const v of series) {
    sum += v;
    out.push(sum);
  }
  return out;
}

// Demand over 24 hours in 5-minute steps: interactive work spread across the
// span with the peak-hour bump, unattended (agent) work queued flat into the
// unattended window after the span.
export function demand24(config, { tokens_interactive, tokens_agent, span_h, unattended_h, peak_share }) {
  const steps = HOURS_PER_DAY * SIM_STEPS_PER_HOUR;
  const interactive = spanStepWeights(config, { span_h, peak_share });
  const series = new Array(steps).fill(ZERO);
  for (let i = ZERO; i < interactive.length; i++) {
    series[i] += interactive[i] * tokens_interactive;
  }
  if (tokens_agent > ZERO && unattended_h > ZERO) {
    const start = Math.min(steps - ONE, Math.floor(span_h * SIM_STEPS_PER_HOUR));
    const width = Math.max(ONE, Math.floor(unattended_h * SIM_STEPS_PER_HOUR));
    const perStep = tokens_agent / width;
    for (let i = start; i < Math.min(steps, start + width); i++) {
      series[i] += perStep;
    }
  }
  return series;
}

// Delivered tokens for one option kind over the same 24 hours.
// opts: { kind, demand, rate_tps, allowance, window_h, burst_tps,
//         rented_h (optional bound for hourly rental) }
export function delivered24(config, opts) {
  const {
    kind, demand, rate_tps, allowance, window_h, burst_tps, rented_h
  } = opts;

  const steps = demand.length;
  const delivered = new Array(steps).fill(ZERO);
  const locked = new Array(steps).fill(false);

  if (kind === 'local') {
    // Local delivers at its decode rate; any backlog continues after the span
    // (steady and continuing overnight, spec chart 4).
    const perStep = rate_tps * STEP_SECONDS;
    let backlog = ZERO;
    for (let i = ZERO; i < steps; i++) {
      backlog += demand[i];
      const done = Math.min(backlog, perStep);
      delivered[i] = done;
      backlog -= done;
    }
    return { delivered, locked, backlog_tokens: backlog };
  }

  if (kind === 'subscription') {
    // Windows reset every window_h from the start of the day; each window's
    // demand is front-loaded into a session burst (D17); delivery is capped
    // by the burst rate and by what is left in the window.
    const windowH = window_h != null ? window_h : pval(config, 'subscriptions.window_h');
    const cap = burst_tps != null ? burst_tps : Infinity;
    const stepsPerWindow = Math.max(ONE, Math.round(windowH * SIM_STEPS_PER_HOUR));
    const burstDemand = frontLoadSeries(demand, stepsPerWindow, config);
    let budget = allowance != null ? allowance : ZERO;
    let stepInWindow = ZERO;
    for (let i = ZERO; i < steps; i++) {
      if (stepInWindow === stepsPerWindow) {
        budget = allowance != null ? allowance : ZERO;
        stepInWindow = ZERO;
      }
      const wanted = Math.min(burstDemand[i], cap * STEP_SECONDS);
      const done = Math.min(wanted, Math.max(ZERO, budget));
      budget -= done;
      delivered[i] = done;
      locked[i] = done < burstDemand[i];
      stepInWindow += ONE;
    }
    return { delivered, locked, backlog_tokens: ZERO };
  }

  if (kind === 'rental_hourly') {
    // Available only during rented hours; the rest of the day delivers nothing.
    const rentSteps = rented_h != null ? Math.round(rented_h * SIM_STEPS_PER_HOUR) : steps;
    const cap = burst_tps != null ? burst_tps : Infinity;
    for (let i = ZERO; i < Math.min(steps, rentSteps); i++) {
      delivered[i] = Math.min(demand[i], cap * STEP_SECONDS);
      locked[i] = demand[i] > delivered[i];
    }
    return { delivered, locked, backlog_tokens: ZERO };
  }

  // API and monthly rental deliver on demand, capped only by burst speed.
  const cap = burst_tps != null ? burst_tps : Infinity;
  for (let i = ZERO; i < steps; i++) {
    delivered[i] = Math.min(demand[i], cap * STEP_SECONDS);
    locked[i] = demand[i] > delivered[i];
  }
  return { delivered, locked, backlog_tokens: ZERO };
}

// Convenience for charts: demand and delivered cumulative series.
export function profile24(config, { tokens_interactive, tokens_agent, span_h, unattended_h, peak_share }, opts) {
  const demand = demand24(config, { tokens_interactive, tokens_agent, span_h, unattended_h, peak_share });
  const result = delivered24(config, { ...opts, demand });
  return {
    step_minutes: SIM_STEP_MINUTES,
    demand: cumulative(demand),
    delivered: cumulative(result.delivered),
    locked: result.locked,
    backlog_tokens: result.backlog_tokens,
    demand_total: demand.reduce((a, b) => a + b, ZERO)
  };
}
