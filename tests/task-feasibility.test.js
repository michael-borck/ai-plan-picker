// Task completion feasibility tests (spec 2.1, docs/decisions.md D19).
// The user's scenario: a cheap option that cannot finish a meaningful task
// is not a plan, it is a waiting room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../src/engine/compute.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('compute attaches task reality to every option', () => {
  const r = compute(config, { persona: 'power', usage_mode: 'agentic', horizon_years: 3 });
  for (const o of r.options) {
    assert.ok(Array.isArray(o.task_cells) && o.task_cells.length === 7, o.id + ' has a cell per task type');
    assert.ok(o.own_share >= 0 && o.own_share <= 1);
    assert.ok(Number.isFinite(o.completed_fraction));
  }
  // The free chat tier cannot run agent tasks: that cell is No with the
  // reason, and the work goes to top-up instead of excluding the option.
  const free = r.options.find(o => o.id === 'sub_free');
  const agentic = free.task_cells.find(c => c.task_id === 'agentic_task');
  assert.equal(agentic.status, 'no');
  assert.equal(agentic.reasons[0], 'No agent or coding tools');
  assert.ok(agentic.topup_class, 'the agentic work is topped up');
  assert.equal(free.completed_fraction, 1, 'with top-up the week still completes');
});

test('typical chat: the broker free plan can cover the week and wins on cost', () => {
  // CR-001: a broker free plan with 50 requests a day covers a typical chat
  // week (about 157 requests with retries), so a zero-price plan can now win.
  // The recommendation text must explain what the free route involves.
  const r = compute(config, { persona: 'typical', quality_target: 'good', horizon_years: 3 });
  assert.equal(r.recommendation.winner.id, 'broker_broker_free');
  assert.ok(r.recommendation.winner.own_share >= 1);
  const text = r.recommendation.text;
  assert.ok(text.includes('On its own') || text.includes('whole week on its own'), 'the advice names the own share');
  assert.ok(text.includes('cheapest route that is not free'), 'the free-winner line names the cheapest paid route');
  assert.ok(text.includes('request limits'), 'the free route is explained');
  assert.ok(text.includes('pays off') || text.includes('pays for itself'), 'the pay-off multiple line is present');
});

test('cost per completed task charges the top-up to the incomplete option', () => {
  // Base in the agentic scenario is far too small for a power user's week:
  // its own share is low, the shortfall is topped up, and the TCO including
  // top-up makes its per-task cost worse than the pay-as-you-go option.
  const r = compute(config, { persona: 'power', usage_mode: 'agentic', quality_target: 'good', horizon_years: 3 });
  const base = r.options.find(o => o.id === 'sub_base');
  const api = r.options.find(o => o.id === 'api_cheap');
  assert.ok(base.own_share < 1, 'base cannot cover agentic demand on its own, own share ' + base.own_share.toFixed(2));
  assert.ok(base.topup_monthly_aud > 0, 'the shortfall is topped up');
  assert.equal(base.completed_fraction, 1, 'with top-up the week completes');
  assert.ok(base.cost_per_completed_task_aud > api.cost_per_completed_task_aud,
    'base per task ' + base.cost_per_completed_task_aud.toFixed(4) + ' vs api ' + api.cost_per_completed_task_aud.toFixed(4));
});
