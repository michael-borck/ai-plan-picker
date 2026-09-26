// taskLayer.js unit tests (spec 2.8; CR-001 items 2 and 3).
// Acceptance tests N1 to N11 live in tests/n-tests.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskTypesForInputs, successRate, contextNeedK, evaluateTask, fillWeekly, weeklyLimitsFor, qualityRank } from '../src/engine/taskLayer.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

const LOCAL_OPT = {
  id: 'local_test', family: 'local', kind: 'local',
  quality_level: 'good', context_k: 32, agent_tools: true, reliability: 1,
  may_train: false, vetoed: false,
  verbosity: 1.30, gen_tps: 33, prefill_tps: 660, ttft_s: 0.5,
  price_in_aud: null, price_out_aud: null
};

function findTask(config, id) {
  return config.task_types.find(t => t.id === id);
}

test('quality rank orders the four levels', () => {
  assert.ok(qualityRank('basic') < qualityRank('good'));
  assert.ok(qualityRank('good') < qualityRank('high'));
  assert.ok(qualityRank('high') < qualityRank('frontier'));
});

test('counts per week: typical workday chat', () => {
  const tasks = taskTypesForInputs(config, { persona: 'typical', usage_preset: 'workday', usage_mode: 'chat' });
  const quick = tasks.find(t => t.id === 'quick_question');
  // 15 queries/day x 0.35 share x 7 days
  assert.ok(Math.abs(quick.count_per_week - 15 * 0.35 * 7) < 1e-9);
  const agentic = tasks.find(t => t.id === 'agentic_task');
  assert.equal(agentic.count_per_week, 0);
  const hard = tasks.find(t => t.id === 'hard_problem');
  assert.equal(hard.count_per_week, 0);
});

test('counts per week: agent presets fill the agentic task', () => {
  const tasks = taskTypesForInputs(config, { persona: 'typical', usage_preset: 'workday_agents', usage_mode: 'chat' });
  const agentic = tasks.find(t => t.id === 'agentic_task');
  assert.equal(agentic.count_per_week, 20 * 7);
});

test('counts per week: own week replaces the demand model', () => {
  const inputs = { persona: 'typical', usage_preset: 'workday', usage_mode: 'chat', own_week: { enabled: true, counts: { quick_question: 10, hard_problem: 2 } } };
  const tasks = taskTypesForInputs(config, inputs);
  assert.equal(tasks.find(t => t.id === 'quick_question').count_per_week, 10);
  assert.equal(tasks.find(t => t.id === 'hard_problem').count_per_week, 2);
  assert.equal(tasks.find(t => t.id === 'document_summary').count_per_week, 0);
});

test('success rate by gap and the p_min floor', () => {
  assert.equal(successRate(config, 0), 0.95);
  assert.equal(successRate(config, 1), 0.60);
  assert.equal(successRate(config, 2), 0.25);
  assert.equal(successRate(config, 3), 0.05);
});

test('context need is per step with thinking, overridable', () => {
  const rag = findTask(config, 'analysis_rag');
  assert.equal(contextNeedK(config, rag, 1), 11); // 10000 + 1000, rounded up
  assert.equal(contextNeedK(config, { ...rag, context_need_k: 45 }, 1), 45);
});

test('gate 1: context failure is No with the numbers in the reason', () => {
  const rag = { ...findTask(config, 'analysis_rag'), context_need_k: 45 };
  const cell = evaluateTask(config, rag, { ...LOCAL_OPT, context_k: 32 }, { thinking: 'off' });
  assert.equal(cell.status, 'no');
  assert.equal(cell.reasons[0], 'Needs 45k context, has 32k');
});

test('gate 2: agentic task on an option without agent tools', () => {
  const agentic = findTask(config, 'agentic_task');
  const cell = evaluateTask(config, agentic, { ...LOCAL_OPT, agent_tools: false }, { thinking: 'off' });
  assert.equal(cell.status, 'no');
  assert.equal(cell.reasons[0], 'No agent or coding tools');
});

test('gate 3: weak model is No, one level down is Slow with retries', () => {
  const coding = findTask(config, 'code_data_assist'); // needs high
  const weak = evaluateTask(config, coding, { ...LOCAL_OPT, quality_level: 'basic' }, { thinking: 'off' });
  assert.equal(weak.status, 'no'); // gap 2 < p_min? p 0.25 >= 0.30? no: 0.25 < 0.30 -> No
  assert.equal(weak.reasons[0], 'Model too weak for this task');
  const oneDown = evaluateTask(config, coding, { ...LOCAL_OPT, quality_level: 'good' }, { thinking: 'off' });
  assert.equal(oneDown.p, 0.60);
  assert.ok(Math.abs(oneDown.attempts - 1 / 0.60) < 1e-9);
  assert.equal(oneDown.status, 'slow');
});

test('gate 4: vetoed option fails every task with the reason', () => {
  const quick = findTask(config, 'quick_question');
  const cell = evaluateTask(config, quick, { ...LOCAL_OPT, vetoed: true, veto_reason: 'Blocked by your data rule' }, { thinking: 'off' });
  assert.equal(cell.status, 'no');
  assert.equal(cell.reasons[0], 'Blocked by your data rule');
});

test('quantities: cached input excluded locally, weighted for allowance', () => {
  // Agentic step: 15000 in, 70 percent cacheable, 800 out, thinking low.
  const agentic = findTask(config, 'agentic_task');
  const cell = evaluateTask(config, agentic, { ...LOCAL_OPT, verbosity: 1.0, quality_level: 'high' }, { thinking: 'low' });
  // attempts 1/0.95; per step new_in 4500, out 1200
  assert.ok(Math.abs(cell.requests - 20 / 0.95) < 1e-9);
  const perStepLocal = 4500 + 1200;
  assert.ok(Math.abs(cell.gen_s / cell.requests - (0.5 + 4500 / 660 + 1200 / 33)) < 1e-9);
  // units use the subscription cache weight on cached input
  const cacheWeight = config.parameters['subscriptions.cache_weight'].value;
  assert.ok(Math.abs(cell.units - cell.requests * (4500 + 10500 * cacheWeight + 1200)) < 1e-9);
  assert.ok(perStepLocal > 0);
});

test('fill: smallest tasks first and the last type partly done', () => {
  const tasks = [
    { id: 'a', steps: 1, input_per_step: 1000, output_per_step: 1000, count_per_week: 10, size: 2000 },
    { id: 'b', steps: 1, input_per_step: 10000, output_per_step: 1000, count_per_week: 4, size: 11000 }
  ];
  const cells = [
    { status: 'yes', units: 2000, requests: 1, gen_s: 3600, size: 2000 },
    { status: 'yes', units: 11000, requests: 1, gen_s: 7200, size: 11000 }
  ];
  // Allowance 26000: a is fully done (20000) and b is partly done.
  const r = fillWeekly(config, tasks, cells, { allowance_weekly: 26000 });
  assert.equal(r.done[0], 10);
  assert.ok(Math.abs(r.done[1] - 6000 / 11000) < 1e-9);
  const sizeAll = 10 * 2000 + 4 * 11000;
  const sizeDone = 10 * 2000 + (6000 / 11000) * 11000;
  assert.ok(Math.abs(r.own_share - sizeDone / sizeAll) < 1e-9);
});

test('fill: hours limit uses generation time, not wall time', () => {
  const tasks = [{ id: 'a', steps: 1, input_per_step: 1000, output_per_step: 1000, count_per_week: 10, size: 2000 }];
  const cells = [{ status: 'yes', units: 2000, requests: 1, gen_s: 1800, size: 2000 }]; // 0.5 h per task
  const r = fillWeekly(config, tasks, cells, { hours_per_week: 56 });
  assert.equal(r.done[0], 10);
  assert.equal(r.own_share, 1);
});

test('weekly limits: window plans are capped by the weekly cap', () => {
  const limits = weeklyLimitsFor(config, { kind: 'window', allowance_per_window: 200000 }, { usage_preset: 'workday' });
  // 2 windows a day x 7 days = 14, capped at 12 windows.
  assert.ok(Math.abs(limits.allowance_weekly - 12 * 200000) < 1e-9);
});
