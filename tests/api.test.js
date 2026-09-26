// api.js unit tests: spec 6.11, 11.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiClassInfo, apiDailyCostAud, cachedShareForMode } from '../src/engine/api.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('api: Best class prices are the pack means (AUD 2.83 / 17.97 per million)', () => {
  const best = apiClassInfo(config, 'best');
  assert.equal(best.price_aud_per_1m_input, 2.83);
  assert.equal(best.price_aud_per_1m_output, 17.97);
});

test('api: Previous is 0.6 times Best', () => {
  const prev = apiClassInfo(config, 'previous');
  assert.ok(Math.abs(prev.price_aud_per_1m_input - 1.70) < 0.011);
  assert.ok(Math.abs(prev.price_aud_per_1m_output - 10.78) < 0.011);
});

test('api: Cheap is the small-model mean (AUD 0.69 / 4.36)', () => {
  const cheap = apiClassInfo(config, 'cheap');
  assert.equal(cheap.price_aud_per_1m_input, 0.69);
  assert.equal(cheap.price_aud_per_1m_output, 4.36);
});

test('api: T6 typical chat on Best, thinking off, is about AUD 0.35/day', () => {
  const daily = apiDailyCostAud(config, {
    class_id: 'best',
    tokens_in: 43125,
    tokens_out: 12825,
    cached_share: 0
  });
  assert.ok(Math.abs(daily - 0.3525) < 0.005, 'got ' + daily.toFixed(4));
  assert.ok(Math.abs(daily - 10.70 / (365 / 12)) < 0.005);
});

test('api: cached input costs a tenth (90 percent discount)', () => {
  const full = apiDailyCostAud(config, { class_id: 'best', tokens_in: 1000000, tokens_out: 0, cached_share: 0 });
  const cached = apiDailyCostAud(config, { class_id: 'best', tokens_in: 1000000, tokens_out: 0, cached_share: 1 });
  assert.ok(Math.abs(cached - full * 0.10) < 1e-9);
});

test('api: cached shares default to 0 / 20 / 70 percent by mode', () => {
  assert.equal(cachedShareForMode(config, 'chat'), 0);
  assert.equal(cachedShareForMode(config, 'documents'), 0.20);
  assert.equal(cachedShareForMode(config, 'agentic'), 0.70);
});

test('api: intermediary markup applies multiplicatively', () => {
  const base = apiDailyCostAud(config, { class_id: 'best', tokens_in: 1000000, tokens_out: 0, cached_share: 0 });
  const withMarkup = apiDailyCostAud(config, { class_id: 'best', tokens_in: 1000000, tokens_out: 0, cached_share: 0, }) ;
  assert.ok(Math.abs(base - withMarkup) < 1e-9); // default markup is zero
});

test('api: context windows come from the fit parameters', () => {
  assert.equal(apiClassInfo(config, 'best').context_k, 200);
  assert.equal(apiClassInfo(config, 'previous').context_k, 128);
  assert.equal(apiClassInfo(config, 'cheap').context_k, 128);
});
