// Chart ribbon (spec 7 chart 1): banded envelope around the winner and
// runner-up cumulative TCO lines, built from the one-at-a-time sensitivity
// swings. Costs no extra computes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../src/engine/compute.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('ribbon: with_bands yields envelopes that bracket the base lines', () => {
  const r = compute(config, { horizon_years: 3, with_bands: true, persona: 'power', usage_mode: 'agentic' });
  assert.ok(r.band && r.band.options, 'band present');
  const w = r.recommendation.winner;
  const ru = r.recommendation.runner_up;
  for (const o of [w, ru]) {
    const env = r.band.options[o.id];
    assert.ok(env, 'envelope for ' + o.id);
    for (let m = 0; m <= 60; m++) {
      const base = o.tco_series.nominal[m];
      assert.ok(env.low[m] <= base + 1e-6, o.id + ' month ' + m + ' low <= base');
      assert.ok(env.high[m] >= base - 1e-6, o.id + ' month ' + m + ' high >= base');
      assert.ok(env.low[m] <= env.high[m] + 1e-6, o.id + ' month ' + m + ' ordered');
    }
  }
});

test('ribbon: absent unless requested', () => {
  const r = compute(config, { horizon_years: 3 });
  assert.equal(r.band, null);
});

test('ribbon: the band moves the lines that matter (local winner reacts to its bands)', () => {
  const r = compute(config, { horizon_years: 5, with_bands: true, persona: 'power', usage_mode: 'agentic' });
  const w = r.recommendation.winner;
  assert.equal(w.family, 'local');
  const env = r.band.options[w.id];
  const width = env.high[60] - env.low[60];
  assert.ok(width > 0, 'the envelope has width at the end of the series: ' + width.toFixed(0));
});
