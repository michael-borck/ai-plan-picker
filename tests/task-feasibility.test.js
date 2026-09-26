// Task completion feasibility tests (spec 2.1, docs/decisions.md D19).
// The user's scenario: a cheap option that cannot finish a meaningful task
// is not a plan, it is a waiting room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { representativeTask, taskCompletion, taskVerdict } from '../src/engine/taskTime.js';
import { compute } from '../src/engine/compute.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('representative task is the biggest in the mix', () => {
  const big = representativeTask([
    { input_tokens: 500, output_tokens: 500 },
    { input_tokens: 10000, output_tokens: 1000 },
    { input_tokens: 2000, output_tokens: 1500 }
  ]);
  assert.equal(big.input_tokens, 10000);
});

test('a task bigger than the window needs resets and pauses mid-task', () => {
  // An agentic task (300k in / 16k out) on a 20k-token free window.
  const check = taskCompletion(config, {
    task_in: 300000, task_out: 16000, thinking_mult: 1, efficiency: 1.1,
    gen_tps: 150, ttft_s: 1.5, allowance_per_window: 20000, window_h: 5
  });
  assert.ok(Math.abs(check.tokens - 317600) < 1);
  assert.equal(check.windows_needed, 16);
  assert.ok(Math.abs(check.pause_s - 15 * 5 * 3600) < 1, '15 resets at 5 h each');
  assert.equal(check.fits_session, false);
  assert.ok(taskVerdict(check).includes('windows'));
});

test('a task inside one window finishes without pauses', () => {
  const check = taskCompletion(config, {
    task_in: 10000, task_out: 1000, thinking_mult: 1, efficiency: 1.1,
    gen_tps: 150, ttft_s: 1.5, allowance_per_window: 20000, window_h: 5
  });
  assert.equal(check.windows_needed, 1);
  assert.equal(check.pause_s, 0);
  assert.equal(check.fits_session, true);
});

test('a slow local build fails on generation time alone', () => {
  // 1 tok/s decode: a 1,000-token answer takes about 17 minutes.
  const check = taskCompletion(config, {
    task_in: 10000, task_out: 1000, thinking_mult: 1, efficiency: 1.21,
    gen_tps: 1, ttft_s: 200, allowance_per_window: null, window_h: null
  });
  assert.equal(check.fits_session, false);
  assert.ok(taskVerdict(check).includes('Too slow'));
});

test('compute attaches task reality to every option', () => {
  const r = compute(config, { persona: 'power', usage_mode: 'agentic', horizon_years: 3 });
  for (const o of r.options) {
    assert.ok(o.task_check, o.id + ' has a task check');
    assert.ok(o.task_verdict, o.id + ' has a verdict');
    if (o.coverage > 0 && o.cost_per_task_aud != null) {
      assert.ok(Math.abs(o.cost_per_completed_task_aud - o.cost_per_task_aud / o.coverage) < 1e-9);
    }
  }
  // The free tier cannot finish an agentic task: it must be filtered.
  const free = r.options.find(o => o.id === 'sub_free');
  assert.equal(free.task_check.fits_session, false);
  assert.equal(free.passes_filters, false);
  assert.ok(free.task_verdict.includes('windows'));
});

test('typical chat winners are unaffected but carry verdicts', () => {
  const r = compute(config, { persona: 'typical', quality_target: 'good', horizon_years: 3 });
  assert.equal(r.recommendation.winner.id, 'api_cheap');
  assert.ok(r.recommendation.text.includes('Biggest task'));
});

test('cost per completed task penalises options that run dry', () => {
  // Base in the agentic scenario is far too small for a power user's day, so
  // its coverage is low; the free tier costs nothing either way, so use Base.
  const r = compute(config, { persona: 'power', usage_mode: 'agentic', quality_target: 'good', horizon_years: 3 });
  const base = r.options.find(o => o.id === 'sub_base');
  assert.ok(base.coverage < 1, 'base cannot cover agentic demand, coverage ' + base.coverage.toFixed(2));
  assert.ok(base.cost_per_task_aud > 0);
  assert.ok(base.cost_per_completed_task_aud > base.cost_per_task_aud);
});
