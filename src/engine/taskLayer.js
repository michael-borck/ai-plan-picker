// taskLayer.js: the task layer (spec 2.8; CR-001 items 2 and 3).
//
// Work arrives as whole tasks. Every task type is checked against every
// option through six gates, in order: context, agent tools, quality
// (success rate), sensitivity veto, single-task fit (window or request
// spans), and session time. A task that passes is Yes; limited tasks are
// Slow, never excluded; only gate failures are No.
//
// Convention statement (CR section 4): decision D2 is kept. Demand accrues
// on every calendar day, so a week is seven days everywhere here: weekly
// task counts are daily counts times seven, and weekly request capacity is
// requests per day times seven.

import { pval } from './params.js';
import { usagePresetById, personaById } from './demand.js';
import {
  DAYS_PER_WEEK, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, HOURS_PER_DAY,
  TOKENS_PER_MILLION, ZERO, ONE, SUM_EPSILON, KILO
} from './units.js';

const QUALITY_ORDER = ['basic', 'good', 'high', 'frontier'];

export function qualityRank(level) {
  return QUALITY_ORDER.indexOf(level);
}

// Per-task-type counts per week (spec 2.8). Defaults come from the demand
// model (persona, usage preset, usage mode); "Use my own week" replaces
// them with typed counts per week.
export function taskTypesForInputs(config, inputs) {
  const own = inputs && inputs.own_week && inputs.own_week.enabled ? inputs.own_week.counts : null;
  return config.task_types.map(t => {
    const perWeek = own ? (Number(own[t.id]) || ZERO) : dailyCount(config, inputs, t) * DAYS_PER_WEEK;
    return { ...t, count_per_week: perWeek };
  });
}

function dailyCount(config, inputs, taskType) {
  if (taskType.id === 'hard_problem') return ZERO;
  const preset = usagePresetById(config, inputs.usage_preset);
  const persona = personaById(config, inputs.persona);
  const queries = persona.queries_per_day * preset.query_multiplier;

  if (taskType.id === 'agentic_task') {
    const agents = preset.agent_tasks > ZERO ? preset.agent_tasks : ZERO;
    const interactive = inputs.usage_mode === 'agentic' ? queries : ZERO;
    return interactive + agents;
  }
  if (inputs.usage_mode === 'agentic') return ZERO; // all interactive work is agentic in this mode

  if (inputs.usage_mode === 'documents') {
    const mode = config.usage_modes.find(m => m.id === 'documents');
    return (mode.mix[taskType.id] || ZERO) * queries;
  }
  // Chat: persona shares over the pack's five task types.
  const pack = config.tables.workload.tasks.find(t => t.id === taskType.id);
  if (!pack) return ZERO;
  const shareKey = { power: 'share_power', typical: 'share_typical', light: 'share_light' }[inputs.persona];
  return (pack[shareKey] || ZERO) * queries;
}

export function successRate(config, gap) {
  if (gap <= ZERO) return pval(config, 'tasks.success_same');
  if (gap === ONE) return pval(config, 'tasks.success_gap1');
  if (gap === 2) return pval(config, 'tasks.success_gap2');
  return pval(config, 'tasks.success_gap3');
}

// Context one step needs, in k tokens: input plus expected output with
// thinking, rounded up; a per-task override wins (spec 2.8).
export function contextNeedK(config, task, thinking_mult) {
  if (task.context_need_k != null) return task.context_need_k;
  const tokens = task.input_per_step + task.output_per_step * thinking_mult;
  return Math.ceil(tokens / KILO);
}

// Gates 1 to 6 for one task on one option (spec 2.8). opt carries the
// option's task attributes: quality_level, context_k, agent_tools,
// reliability, may_train, vetoed, kind, speed, and the metering fields.
export function evaluateTask(config, task, opt, inputs) {
  const thinking = pval(config, 'thinking.' + inputs.thinking);
  const out = task.output_per_step * thinking * opt.verbosity;
  const newIn = task.input_per_step * (ONE - task.cacheable_share);
  const cached = task.input_per_step * task.cacheable_share;

  // Gate 1: context.
  const ctxNeed = contextNeedK(config, task, thinking);
  if (ctxNeed > opt.context_k) {
    return no(task, 'Needs ' + ctxNeed + 'k context, has ' + opt.context_k + 'k', ctxNeed);
  }
  // Gate 2: agent tools.
  if (task.needs_agent_tools && !opt.agent_tools) {
    return no(task, 'No agent or coding tools', ctxNeed);
  }
  // Gate 3: quality via success rate.
  const gap = qualityRank(task.quality_needed) - qualityRank(opt.quality_level);
  const p = successRate(config, gap);
  if (p < pval(config, 'tasks.p_min')) {
    return no(task, 'Model too weak for this task', ctxNeed);
  }
  // Gate 4: sensitivity veto.
  if (opt.vetoed) {
    return no(task, opt.veto_reason || 'Blocked by your data rule', ctxNeed);
  }

  // Per-task quantities (spec 2.8).
  const attempts = ONE / (p * (opt.reliability != null ? opt.reliability : ONE));
  const requests = attempts * task.steps;
  const cacheWeight = pval(config, 'subscriptions.cache_weight');
  const units = requests * (newIn + cached * cacheWeight + out);
  let apiAud = ZERO;
  if (opt.price_in_aud != null) {
    const discount = ONE - pval(config, 'api.cache_discount');
    apiAud = requests * ((newIn + cached * discount) * opt.price_in_aud + out * opt.price_out_aud) / TOKENS_PER_MILLION;
  }
  const tStep = opt.ttft_s + newIn / opt.prefill_tps + out / opt.gen_tps;
  let wall = requests * tStep;
  const slow = [];
  let spans = ONE;

  // Gate 5: single-task fit for metered plans.
  if (opt.kind === 'window' && opt.allowance_per_window > ZERO) {
    spans = Math.ceil(units / opt.allowance_per_window);
    if (opt.weekly_allowance != null && units > opt.weekly_allowance) {
      return no(task, 'One task is bigger than the weekly allowance', ctxNeed);
    }
    if (spans > ONE) {
      wall += (spans - ONE) * opt.window_h * SECONDS_PER_HOUR;
      slow.push('Spans ' + spans + ' reset windows');
    }
  }
  if (opt.kind === 'requests' && opt.requests_per_day > ZERO) {
    spans = Math.ceil(requests / opt.requests_per_day);
    if (spans > ONE) {
      wall += (spans - ONE) * HOURS_PER_DAY * SECONDS_PER_HOUR;
      slow.push('Spans ' + spans + ' days of request limits');
    }
    const floorS = requests / opt.requests_per_min * SECONDS_PER_MINUTE;
    if (floorS > wall) wall = floorS;
  }

  // Gate 6: session time makes the task Slow, never No (v0.4; supersedes
  // decision D19). Agent tasks use the agent tolerance unless the preset has
  // unattended hours, in which case nobody is watching.
  const preset = usagePresetById(config, inputs.usage_preset || 'workday');
  const agentWatched = task.needs_agent_tools && !(preset.unattended_h > ZERO);
  const toleranceMin = agentWatched
    ? pval(config, 'tasks.agent_tolerance_min')
    : pval(config, 'tasks.session_tolerance_min');
  if (wall > toleranceMin * SECONDS_PER_MINUTE) {
    slow.push('About ' + Math.round(wall / SECONDS_PER_MINUTE) + ' min per task');
  }
  // Retries are a limitation, not a failure (spec 2.8: Slow when p < 0.95).
  if (p < pval(config, 'tasks.success_same')) {
    slow.push('Often needs retries (' + Math.round(p * 100) + '% success)');
  }

  return {
    task_id: task.id,
    status: slow.length ? 'slow' : 'yes',
    reasons: slow,
    p,
    attempts,
    requests,
    units,
    api_aud: apiAud,
    wall_s: wall,
    gen_s: requests * tStep,
    spans,
    ctx_need_k: ctxNeed,
    size: task.steps * (task.input_per_step + task.output_per_step)
  };
}

function no(task, reason, ctxNeed) {
  return {
    task_id: task.id,
    status: 'no',
    reasons: [reason],
    p: ZERO,
    attempts: ZERO,
    requests: ZERO,
    units: ZERO,
    api_aud: ZERO,
    wall_s: ZERO,
    gen_s: ZERO,
    spans: ZERO,
    ctx_need_k: ctxNeed,
    size: task.steps * (task.input_per_step + task.output_per_step)
  };
}

// Weekly limits for an option (spec 2.8): hours for local and rental,
// allowance tokens for window plans (usable windows times allowance, capped
// by the weekly cap), requests for request-limited plans, none for API.
export function weeklyLimitsFor(config, opt, inputs) {
  const preset = usagePresetById(config, inputs.usage_preset);
  const days = DAYS_PER_WEEK; // D2: demand every day
  if (opt.kind === 'local' || opt.kind === 'rental') {
    return { hours_per_week: (preset.interactive_h + preset.unattended_h) * days };
  }
  if (opt.kind === 'window') {
    const windowH = pval(config, 'subscriptions.window_h');
    const windowsPerDay = Math.ceil(preset.interactive_h / windowH)
      + (preset.unattended_h > ZERO ? Math.ceil(preset.unattended_h / windowH) : ZERO);
    const weeklyWindows = Math.min(windowsPerDay * days, pval(config, 'subscriptions.weekly_cap_windows'));
    return { allowance_weekly: weeklyWindows * opt.allowance_per_window };
  }
  if (opt.kind === 'requests') {
    return { requests_weekly: opt.requests_per_day * days };
  }
  return {};
}

// Weekly fill (spec 2.8, CR-001 item 3). Feasible tasks are filled smallest
// first by units per task until a weekly limit is reached; the last task
// type may be partly done.
export function fillWeekly(config, tasks, cells, limits) {
  let remainingH = limits.hours_per_week != null ? limits.hours_per_week : null;
  let remainingU = limits.allowance_weekly != null ? limits.allowance_weekly : null;
  let remainingR = limits.requests_weekly != null ? limits.requests_weekly : null;

  const order = tasks
    .map((t, i) => ({ i, cell: cells[i], task: t }))
    .filter(x => x.cell.status !== 'no' && x.task.count_per_week > ZERO)
    .sort((a, b) => a.cell.units / a.task.steps - b.cell.units / b.task.steps);

  let remainingH2 = remainingH;
  let remainingU2 = remainingU;
  let remainingR2 = remainingR;
  let doneSize = ZERO;
  let allSize = ZERO;

  tasks.forEach((t, i) => {
    // Size comes from the evaluated cell (evaluateTask), not the raw config.
    allSize += t.count_per_week * cells[i].size;
  });

  const done = new Array(tasks.length).fill(ZERO);
  for (const x of order) {
    const { task, cell, i } = x;
    let cap = task.count_per_week;
    if (remainingH2 != null) {
      const hPerTask = cell.gen_s / SECONDS_PER_HOUR;
      cap = hPerTask > ZERO ? Math.min(cap, remainingH2 / hPerTask) : Math.min(cap, remainingH2 >= ZERO ? task.count_per_week : ZERO);
    }
    if (remainingU2 != null) {
      cap = cell.units > ZERO ? Math.min(cap, remainingU2 / cell.units) : Math.min(cap, remainingU2 >= ZERO ? task.count_per_week : ZERO);
    }
    if (remainingR2 != null) {
      cap = cell.requests > ZERO ? Math.min(cap, remainingR2 / cell.requests) : Math.min(cap, remainingR2 >= ZERO ? task.count_per_week : ZERO);
    }
    done[i] = Math.max(ZERO, Math.min(task.count_per_week, cap));
    if (remainingH2 != null) remainingH2 -= done[i] * cell.gen_s / SECONDS_PER_HOUR;
    if (remainingU2 != null) remainingU2 -= done[i] * cell.units;
    if (remainingR2 != null) remainingR2 -= done[i] * cell.requests;
    doneSize += done[i] * cell.size;
  }

  const ownShare = allSize > ZERO ? doneSize / allSize : ONE;
  return {
    done,
    own_share: Math.min(ONE, ownShare > ONE - SUM_EPSILON ? ONE : ownShare)
  };
}
