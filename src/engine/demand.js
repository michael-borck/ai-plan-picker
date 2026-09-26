// demand.js: Standard Query construction, personas, usage presets and modes,
// demand totals and busy time (spec 2.2, 2.3, 2.5, 2.6, 4.3, 4.4, 6.7).
//
// Tokens and Standard Queries are kept distinct everywhere: sq_* variables are
// queries, tokens_* variables are tokens (CLAUDE.md units rule).

import { pval } from './params.js';

export function personaById(config, id) {
  const p = config.tables.workload.personas.find(x => x.id === id);
  if (!p) throw new Error('Unknown persona: ' + id);
  return p;
}

function taskById(config, id) {
  const t = config.tables.workload.tasks.find(x => x.id === id);
  if (!t) throw new Error('Unknown task type: ' + id);
  return t;
}

// Task mix for a usage mode and persona: weighted average input and output
// tokens per Standard Query (spec 2.2). Returns the mix plus the task list
// (used for context checks, spec 8).
export function taskMix(config, mode_id, persona_id) {
  const shareKey = { power: 'share_power', typical: 'share_typical', light: 'share_light' }[persona_id];
  if (!shareKey) throw new Error('Unknown persona: ' + persona_id);

  if (mode_id === 'agentic') {
    const steps = pval(config, 'agentic.steps_per_task');
    const ctxIn = pval(config, 'agentic.context_input_per_step');
    const out = pval(config, 'agentic.output_per_step');
    return {
      sq_in: steps * ctxIn,
      sq_out: steps * out,
      tasks: [{ id: 'agentic_task', label: 'Agentic task', input_tokens: ctxIn, output_tokens: out, share: 1 }]
    };
  }

  let weighted;
  if (mode_id === 'chat') {
    weighted = config.tables.workload.tasks.map(t => ({ task: t, share: t[shareKey] }));
  } else if (mode_id === 'documents') {
    const mode = config.usage_modes.find(m => m.id === 'documents');
    weighted = Object.entries(mode.mix).map(([taskId, share]) => ({ task: taskById(config, taskId), share }));
  } else {
    throw new Error('Unknown usage mode: ' + mode_id);
  }

  let sqIn = 0;
  let sqOut = 0;
  const tasks = [];
  for (const { task, share } of weighted) {
    sqIn += share * task.input_tokens;
    sqOut += share * task.output_tokens;
    tasks.push({ id: task.id, label: task.label, input_tokens: task.input_tokens, output_tokens: task.output_tokens, share });
  }
  return { sq_in: sqIn, sq_out: sqOut, tasks };
}

// The agentic profile used by agent tasks regardless of usage mode (spec 4.3).
export function agenticMix(config) {
  return taskMix(config, 'agentic', 'typical');
}

export function usagePresetById(config, id) {
  const p = config.usage_presets.find(x => x.id === id);
  if (!p) throw new Error('Unknown usage preset: ' + id);
  return p;
}

export function thinkingMultiplier(config, level) {
  return pval(config, 'thinking.' + level);
}

// Demand for one day at year 0, before growth (spec 4.3, 4.4, 6.7, and
// docs/decisions.md D2: demand accrues every calendar day, scaled by the
// preset multiplier; days_per_week shapes the interactive span).
export function demandPerDay(config, inputs) {
  const preset = usagePresetById(config, inputs.usage_preset);
  const interactive = taskMix(config, inputs.usage_mode, inputs.persona);
  const agent = agenticMix(config);
  const agentTasksPerDay = preset.agent_tasks > 0 ? preset.agent_tasks : 0;
  const interactiveQueriesPerDay = personaById(config, inputs.persona).queries_per_day * preset.query_multiplier;

  const sqInInteractive = interactiveQueriesPerDay * interactive.sq_in;
  const sqOutInteractive = interactiveQueriesPerDay * interactive.sq_out;
  const sqInAgent = agentTasksPerDay * agent.sq_in;
  const sqOutAgent = agentTasksPerDay * agent.sq_out;

  return {
    preset,
    interactive,
    agent,
    interactive_queries_per_day: interactiveQueriesPerDay,
    interactive_sq_per_day: interactiveQueriesPerDay,
    agent_tasks_per_day: agentTasksPerDay,
    agent_sq_per_day: agentTasksPerDay,
    sq_per_day: interactiveQueriesPerDay + agentTasksPerDay,
    sq_in_per_day: sqInInteractive + sqInAgent,
    sq_out_per_day: sqOutInteractive + sqOutAgent,
    sq_in_interactive_per_day: sqInInteractive,
    sq_out_interactive_per_day: sqOutInteractive,
    sq_in_agent_per_day: sqInAgent,
    sq_out_agent_per_day: sqOutAgent
  };
}

// Effective size for the capability band (spec 6.7): total params for dense,
// sqrt(total x active) for MoE (rule of thumb, assumed).
export function effectiveSizeB(model) {
  if (!model.moe) return model.total_b;
  return Math.sqrt(model.total_b * model.active_b);
}

// Combined efficiency factor for a local model size (spec 2.5, 11.9).
export function localEfficiencyFactor(config, effectiveB) {
  for (const band of config.efficiency_size_bands) {
    if (band.effective_b_max == null || effectiveB <= band.effective_b_max) return band.factor;
  }
  const last = config.efficiency_size_bands[config.efficiency_size_bands.length - 1];
  return last.factor;
}

export function cloudEfficiencyFactor(config, cloud_class) {
  const factors = config.cloud_efficiency_factors;
  if (!(cloud_class in factors)) throw new Error('Unknown cloud class: ' + cloud_class);
  return factors[cloud_class];
}

// Token demand per day for a given efficiency convention (spec 2.5, 6.7):
// output tokens carry the thinking multiplier; local token demand also carries
// the combined efficiency factor, cloud Best is 1.00.
export function tokensPerDay(sqInPerDay, sqOutPerDay, thinkingMult, efficiency) {
  return {
    tokens_in_per_day: sqInPerDay,
    tokens_out_per_day: sqOutPerDay * thinkingMult * efficiency,
    tokens_per_day: sqInPerDay + sqOutPerDay * thinkingMult * efficiency
  };
}

// Generation time per Standard Query (spec 2.3). Thinking and efficiency hit
// the decode (output) side only; prefill processes input at its own rate.
export function busySecondsPerSq(sq_in, sq_out, { prefill_tps, decode_tps, thinking_mult, efficiency }) {
  return sq_in / prefill_tps + sq_out * thinking_mult * efficiency / decode_tps;
}
