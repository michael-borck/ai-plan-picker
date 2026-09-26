// demand.js unit tests: spec 2.2, 2.3, 2.5, 2.6, 4.3, 4.4, 6.7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskMix, agenticMix, usagePresetById, demandPerDay, effectiveSizeB,
  localEfficiencyFactor, cloudEfficiencyFactor, tokensPerDay, busySecondsPerSq, thinkingMultiplier
} from '../src/engine/demand.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('demand: persona SQ values match the spec 2.2 table', () => {
  const power = taskMix(config, 'chat', 'power');
  assert.ok(Math.abs(power.sq_in - 4175) < 0.01, 'power SQ_in 4175, got ' + power.sq_in);
  assert.ok(Math.abs(power.sq_out - 1015) < 0.01, 'power SQ_out 1015, got ' + power.sq_out);
  const typical = taskMix(config, 'chat', 'typical');
  assert.ok(Math.abs(typical.sq_in - 2875) < 0.01);
  assert.ok(Math.abs(typical.sq_out - 855) < 0.01);
  const light = taskMix(config, 'chat', 'light');
  assert.ok(Math.abs(light.sq_in - 1750) < 0.01);
  assert.ok(Math.abs(light.sq_out - 715) < 0.01);
});

test('demand: documents mode shifts the mix to 50/30/20', () => {
  const mix = taskMix(config, 'documents', 'typical');
  assert.ok(Math.abs(mix.sq_in - (0.5 * 6000 + 0.3 * 10000 + 0.2 * 1000)) < 0.01);
  assert.ok(Math.abs(mix.sq_out - (0.5 * 800 + 0.3 * 1000 + 0.2 * 1200)) < 0.01);
});

test('demand: agentic mix is 300k in, 16k out', () => {
  const mix = agenticMix(config);
  assert.equal(mix.sq_in, 300000);
  assert.equal(mix.sq_out, 16000);
});

test('demand: usage presets match spec 4.3', () => {
  const workday = usagePresetById(config, 'workday');
  assert.equal(workday.interactive_h, 8);
  assert.equal(workday.days_per_week, 5);
  assert.equal(workday.query_multiplier, 1.0);
  const occasional = usagePresetById(config, 'occasional');
  assert.equal(occasional.query_multiplier, 0.3);
  const alwaysOn = usagePresetById(config, 'always_on');
  assert.equal(alwaysOn.query_multiplier, 0.0);
  assert.equal(alwaysOn.agent_tasks, 20);
});

test('demand: typical workday chat is 15 SQ per day', () => {
  const dm = demandPerDay(config, { persona: 'typical', usage_preset: 'workday', usage_mode: 'chat' });
  assert.ok(Math.abs(dm.sq_per_day - 15) < 1e-9);
  assert.ok(Math.abs(dm.sq_in_per_day - 43125) < 0.01);
  assert.ok(Math.abs(dm.sq_out_per_day - 12825) < 0.01);
});

test('demand: power persona chat is 40 SQ and about 207,600 raw tokens', () => {
  const dm = demandPerDay(config, { persona: 'power', usage_preset: 'workday', usage_mode: 'chat' });
  assert.equal(dm.sq_per_day, 40);
  const raw = dm.sq_in_per_day + dm.sq_out_per_day;
  assert.ok(Math.abs(raw - 207600) < 1);
});

test('demand: agent tasks add the agentic profile', () => {
  const dm = demandPerDay(config, { persona: 'typical', usage_preset: 'workday_agents', usage_mode: 'chat' });
  assert.equal(dm.agent_tasks_per_day, 20);
  assert.ok(Math.abs(dm.sq_in_agent_per_day - 20 * 300000) < 0.01);
  const none = demandPerDay(config, { persona: 'typical', usage_preset: 'workday', usage_mode: 'chat' });
  assert.equal(none.agent_tasks_per_day, 0);
});

test('demand: effective size is total for dense, sqrt(total x active) for MoE', () => {
  assert.equal(effectiveSizeB({ total_b: 70, active_b: 70, moe: false }), 70);
  assert.ok(Math.abs(effectiveSizeB({ total_b: 30, active_b: 3, moe: true }) - Math.sqrt(90)) < 1e-9);
});

test('demand: efficiency factors follow the size bands (spec 11.9)', () => {
  assert.equal(localEfficiencyFactor(config, 3), 2.16);
  assert.equal(localEfficiencyFactor(config, 8), 1.56);
  // Effective size rules (spec 6.7): MoE 30B with 3B active has effective
  // size sqrt(90) = 9.49, which lands in the 5 to 20B band.
  assert.equal(localEfficiencyFactor(config, Math.sqrt(90)), 1.56);
  // A dense 30B has effective size 30, in the 20 to 50B band (the CSV's
  // "Local 30B quantised" row at 1.21).
  assert.equal(localEfficiencyFactor(config, 30), 1.21);
  assert.equal(localEfficiencyFactor(config, 70), 1.10);
  assert.equal(cloudEfficiencyFactor(config, 'best'), 1.0);
  assert.equal(cloudEfficiencyFactor(config, 'cheap'), 1.10);
});

test('demand: thinking multipliers are 1 / 1.5 / 3 / 6', () => {
  assert.equal(thinkingMultiplier(config, 'off'), 1);
  assert.equal(thinkingMultiplier(config, 'low'), 1.5);
  assert.equal(thinkingMultiplier(config, 'medium'), 3);
  assert.equal(thinkingMultiplier(config, 'high'), 6);
});

test('demand: token demand applies thinking and efficiency to output', () => {
  const t = tokensPerDay(1000, 500, 3, 1.21);
  assert.ok(Math.abs(t.tokens_per_day - (1000 + 500 * 3 * 1.21)) < 1e-9);
});

test('demand: busy seconds per SQ follow spec 2.3', () => {
  const busy = busySecondsPerSq(2875, 855, { prefill_tps: 600, decode_tps: 40, thinking_mult: 1, efficiency: 1 });
  assert.ok(Math.abs(busy - (2875 / 600 + 855 / 40)) < 1e-9);
});
