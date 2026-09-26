// fitChecks.js, select.js, params.js, recommend.js unit tests.
// spec 8, 6.4a, 10, 6.15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredContextTokens, contextCheck } from '../src/engine/fitChecks.js';
import { modelCandidatesForTarget, budgetLadder, noFitAlternatives } from '../src/engine/select.js';
import { setParam, resetParam, getParam, provenanceText, isBanded } from '../src/engine/params.js';
import { applySensitivityRules } from '../src/engine/recommend.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

// ---- fitChecks (spec 8) ----

test('fit: RAG task at 8k context fails, at 16k passes (T19)', () => {
  const rag = { input_tokens: 10000, output_tokens: 1000 };
  assert.equal(contextCheck(8, requiredContextTokens([rag], 1)).pass, false);
  assert.equal(contextCheck(16, requiredContextTokens([rag], 1)).pass, true);
});

test('fit: thinking raises the required context', () => {
  const rag = { input_tokens: 10000, output_tokens: 1000 };
  assert.ok(requiredContextTokens([rag], 6) > requiredContextTokens([rag], 1));
  assert.equal(requiredContextTokens([rag], 6), 16000);
});

test('fit: the busiest task in a mix sets the requirement', () => {
  const tasks = [
    { input_tokens: 500, output_tokens: 500 },
    { input_tokens: 10000, output_tokens: 1000 },
    { input_tokens: 2000, output_tokens: 1500 }
  ];
  assert.equal(requiredContextTokens(tasks, 1), 11000);
});

// ---- select (spec 6.4a) ----

test('select: quality target Good maps to dense 32 and MoE 30 candidates', () => {
  const c = modelCandidatesForTarget(config, 'good');
  assert.ok(c.some(m => m.total_b === 32 && !m.moe));
  assert.ok(c.some(m => m.total_b === 30 && m.moe && m.active_b === 3));
});

test('select: Basic target uses the 7 to 14B dense rungs', () => {
  const c = modelCandidatesForTarget(config, 'basic');
  // The v0.4 ladder adds a 12B rung inside the Basic range (spec 6.4a).
  assert.deepEqual(c.filter(m => !m.moe).map(m => m.total_b).sort((a, b) => a - b), [7, 8, 12, 14]);
});

test('select: T11 budget-only returns a ladder rung, never an in-between size', () => {
  const r = budgetLadder(config, { budget_aud: 2000, bits: 4.85, context_k: 16, min_speed_tps: 10, must_be_new: false });
  assert.ok(r.qualifies, 'some rung fits a 2000 budget');
  const ladderTotals = [...config.model_ladder.dense_b, ...config.model_ladder.moe.map(m => m.total_b)];
  assert.ok(ladderTotals.includes(r.rung.total_b), r.rung.total_b + ' is a rung');
});

test('select: T11 bigger budgets never select a smaller rung', () => {
  const small = budgetLadder(config, { budget_aud: 800, bits: 4.85, context_k: 16, min_speed_tps: 10, must_be_new: false });
  const big = budgetLadder(config, { budget_aud: 5000, bits: 4.85, context_k: 16, min_speed_tps: 10, must_be_new: false });
  if (small.qualifies && big.qualifies) {
    const eff = m => m.moe ? Math.sqrt(m.total_b * m.active_b) : m.total_b;
    assert.ok(eff(big.rung) >= eff(small.rung));
  }
});

test('select: T5 no-fit alternatives compute what it would take', () => {
  const alt = noFitAlternatives(config, {
    model: { total_b: 70, active_b: 70, moe: false },
    bits: 4.85, context_k: 4, must_be_new: false, min_speed_tps: 10
  });
  assert.ok(alt.cheapest_fit, 'a cheapest fit exists');
  assert.ok(alt.cheapest_fit.price_aud > 300);
  assert.ok(alt.cheapest_meeting_speed, 'a config meeting the speed floor exists');
  assert.ok(alt.cheapest_meeting_speed.price_aud >= alt.cheapest_fit.price_aud);
});

// ---- params (spec 10, T10) ----

test('params: editing a sourced value makes it user-supplied and keeps the original (T10)', () => {
  const id = 'fx.usd_aud';
  const before = getParam(config, id);
  assert.equal(before.status, 'sourced');
  const edited = setParam(config, id, 1.60);
  const after = getParam(edited, id);
  assert.equal(after.status, 'user-supplied');
  assert.equal(after.value, 1.60);
  assert.ok(after.original, 'original kept');
  assert.equal(after.original.value, before.value);
  assert.equal(after.original.status, 'sourced');
  assert.ok(provenanceText(edited, id).includes('original'));
  // The input config is untouched.
  assert.equal(getParam(config, id).value, before.value);
});

test('params: reset restores value and status', () => {
  const edited = setParam(config, 'fx.usd_aud', 1.60);
  const restored = resetParam(edited, 'fx.usd_aud');
  const rec = getParam(restored, 'fx.usd_aud');
  assert.equal(rec.value, 1.54);
  assert.equal(rec.status, 'sourced');
  assert.equal(rec.original, undefined);
});

test('params: editing a second time keeps the first original', () => {
  const one = setParam(config, 'fx.usd_aud', 1.60);
  const two = setParam(one, 'fx.usd_aud', 1.70);
  const rec = getParam(two, 'fx.usd_aud');
  assert.equal(rec.value, 1.70);
  assert.equal(rec.original.value, 1.54);
});

test('params: banded detection', () => {
  assert.ok(isBanded(config, 'power.inference_factor'));
  assert.ok(!isBanded(config, 'gst.rate'));
});

// ---- recommend: sensitivity rules (spec 6.15, T12) ----

test('recommend: sensitive rule vetoes hourly rental, consumer subscriptions and API', () => {
  const rental = { sensitivity_tags: ['rental_hourly'] };
  const sub = { sensitivity_tags: ['subscription_consumer'] };
  const api = { sensitivity_tags: ['api_non_enterprise'] };
  const local = { sensitivity_tags: [] };
  assert.equal(applySensitivityRules(config, 'sensitive', rental).vetoed, true);
  assert.equal(applySensitivityRules(config, 'sensitive', sub).vetoed, true);
  assert.equal(applySensitivityRules(config, 'sensitive', api).vetoed, true);
  assert.equal(applySensitivityRules(config, 'sensitive', local).vetoed, false);
});

test('recommend: monthly rental and budget-offshore API are flagged, not vetoed', () => {
  const monthly = { sensitivity_tags: ['rental_monthly'] };
  const offshore = { sensitivity_tags: ['api_budget_offshore'] };
  const r1 = applySensitivityRules(config, 'sensitive', monthly);
  assert.equal(r1.vetoed, false);
  assert.equal(r1.flagged, true);
  const r2 = applySensitivityRules(config, 'sensitive', offshore);
  assert.equal(r2.flagged, true);
  assert.equal(r2.vetoed, false);
});

test('recommend: internal flags only, public applies none', () => {
  const hourly = { sensitivity_tags: ['rental_hourly'] };
  assert.equal(applySensitivityRules(config, 'internal', hourly).vetoed, false);
  assert.equal(applySensitivityRules(config, 'internal', hourly).flagged, true);
  assert.equal(applySensitivityRules(config, 'public', hourly).flagged, false);
});

test('recommend: reasons are human readable and non-empty when marked', () => {
  const r = applySensitivityRules(config, 'sensitive', { sensitivity_tags: ['rental_hourly'] });
  assert.ok(r.reasons.length > 0);
  assert.ok(r.reasons[0].includes('sensitive'));
});
