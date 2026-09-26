// timeSeries.js unit tests: spec 6.13, 6.14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeTco, tcoAtYear, breakEvenMonth, roiAtHorizon, tasksServed } from '../src/engine/timeSeries.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('series: local starts at capex and accrues monthly costs', () => {
  const s = cumulativeTco(config, {
    kind: 'local', capex_aud: 1000, setup_aud: 0,
    idle_energy_aud_day: 0.5, busy_energy_aud_day: 0.1,
    reserve_aud_month: 5, admin_aud_month: 0, demand_charge_aud_month: 0,
    life_months: 48, residual_on: false, growth: 0
  }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  assert.equal(s.nominal[0], 1000);
  // 30.4167 days of energy per month plus reserve; the 3 percent annual
  // escalation compounds, so the 12-month figure sits slightly above flat.
  const monthly0 = (0.6 * 365 / 12) + 5;
  assert.ok(Math.abs(s.nominal[1] - (1000 + monthly0)) < 0.05);
  assert.ok(s.nominal[12] > 1000 + monthly0 * 12 && s.nominal[12] < 1000 + monthly0 * 13);
});

test('series: repurchase step lands at end of life', () => {
  const s = cumulativeTco(config, {
    kind: 'local', capex_aud: 1000, setup_aud: 0,
    idle_energy_aud_day: 0, busy_energy_aud_day: 0,
    reserve_aud_month: 0, admin_aud_month: 0, demand_charge_aud_month: 0,
    life_months: 48, residual_on: false, growth: 0
  }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  assert.ok(s.nominal[47] < s.nominal[48], 'cumulative jumps at the repurchase');
  assert.ok(Math.abs(s.nominal[48] - 2000) < 1e-9);
  assert.ok(Math.abs(s.nominal[60] - 2000) < 1e-9, 'the second repurchase (month 96) sits outside the series');
});

test('series: residual credits at end of life when enabled', () => {
  const s = cumulativeTco(config, {
    kind: 'local', capex_aud: 1000, setup_aud: 0,
    idle_energy_aud_day: 0, busy_energy_aud_day: 0,
    reserve_aud_month: 0, admin_aud_month: 0, demand_charge_aud_month: 0,
    life_months: 48, residual_on: true, growth: 0
  }, { months: 60, discount_rate: 0, gst_multiplier: 1, residual_share: 0.15 });
  assert.ok(Math.abs(s.nominal[48] - (2000 - 150)) < 1e-9);
  assert.ok(Math.abs(s.nominal[60] - (2000 - 150 - 150)) < 1e-9, 'the retired box is credited at 48 and the in-service box at the horizon');
});

test('series: metered flows grow with demand and fall with price change', () => {
  const flat = cumulativeTco(config, { kind: 'metered', daily_aud: 1, growth: 0, price_change: 0 }, { months: 12, discount_rate: 0, gst_multiplier: 1 });
  assert.ok(Math.abs(flat.nominal[12] - 365) < 0.5);
  const grown = cumulativeTco(config, { kind: 'metered', daily_aud: 1, growth: 0.10, price_change: 0 }, { months: 12, discount_rate: 0, gst_multiplier: 1 });
  assert.ok(grown.nominal[12] > flat.nominal[12]);
  const cheaper = cumulativeTco(config, { kind: 'metered', daily_aud: 1, growth: 0, price_change: -0.15 }, { months: 12, discount_rate: 0, gst_multiplier: 1 });
  assert.ok(cheaper.nominal[12] < flat.nominal[12]);
});

test('series: discount rate shifts present value below nominal', () => {
  const s = cumulativeTco(config, { kind: 'flat', monthly_aud: 100, price_change: 0 }, { months: 60, discount_rate: 0.05, gst_multiplier: 1 });
  assert.ok(Math.abs(s.nominal[60] - 6000) < 0.01);
  assert.ok(s.pv[60] < s.nominal[60]);
  assert.ok(s.pv[60] > 5000);
});

test('series: GST multiplier scales flows when display includes GST', () => {
  const ex = cumulativeTco(config, { kind: 'flat', monthly_aud: 100, price_change: 0 }, { months: 12, discount_rate: 0, gst_multiplier: 1 });
  const incl = cumulativeTco(config, { kind: 'flat', monthly_aud: 100, price_change: 0 }, { months: 12, discount_rate: 0, gst_multiplier: 1.10 });
  assert.ok(Math.abs(incl.nominal[12] - ex.nominal[12] * 1.10) < 1e-9);
});

test('series: T18 break-even equals the first month net saving reaches zero', () => {
  const local = cumulativeTco(config, {
    kind: 'local', capex_aud: 2000, setup_aud: 0,
    idle_energy_aud_day: 0.2, busy_energy_aud_day: 0.05,
    reserve_aud_month: 4, admin_aud_month: 0, demand_charge_aud_month: 0,
    life_months: 48, residual_on: false, growth: 0
  }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  const api = cumulativeTco(config, { kind: 'metered', daily_aud: 3, growth: 0.1, price_change: -0.15 }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  const m = breakEvenMonth(local, api);
  assert.ok(m != null);
  // Net saving of local vs API is api TCO minus local TCO; first non-negative month:
  let first = null;
  for (let i = 0; i <= 60; i++) {
    if (api.nominal[i] - local.nominal[i] >= 0) { first = i; break; }
  }
  assert.equal(m, first);
  // And the cumulative TCO lines cross there: local at or below API.
  assert.ok(local.nominal[m] <= api.nominal[m]);
  if (m > 0) assert.ok(local.nominal[m - 1] > api.nominal[m - 1]);
});

test('series: break-even returns null when lines never cross', () => {
  // A dear local build (big capex and energy) never drops below a cheap flat
  // subscription, so there is no month where the local line falls to it.
  const dear = cumulativeTco(config, {
    kind: 'local', capex_aud: 5000, setup_aud: 0,
    idle_energy_aud_day: 6.56, busy_energy_aud_day: 0,
    reserve_aud_month: 0, admin_aud_month: 0, demand_charge_aud_month: 0,
    life_months: 60, residual_on: false, growth: 0
  }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  const cheap = cumulativeTco(config, { kind: 'flat', monthly_aud: 100, price_change: 0 }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  assert.equal(breakEvenMonth(dear, cheap), null);
});

test('series: TCO at years reads year boundaries', () => {
  const s = cumulativeTco(config, { kind: 'flat', monthly_aud: 100, price_change: 0 }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  assert.ok(Math.abs(tcoAtYear(s, 1) - 1200) < 0.01);
  assert.ok(Math.abs(tcoAtYear(s, 3) - 3600) < 0.01);
});

test('series: ROI is net saving over capex', () => {
  const local = cumulativeTco(config, {
    kind: 'local', capex_aud: 1000, setup_aud: 0,
    idle_energy_aud_day: 0, busy_energy_aud_day: 0,
    reserve_aud_month: 0, admin_aud_month: 0, demand_charge_aud_month: 0,
    life_months: 60, residual_on: false, growth: 0
  }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  const other = cumulativeTco(config, { kind: 'flat', monthly_aud: 50, price_change: 0 }, { months: 60, discount_rate: 0, gst_multiplier: 1 });
  // local TCO 1000, other TCO 3000: saving 2000 on 1000 capex = 200 percent
  assert.ok(Math.abs(roiAtHorizon(local, other, 1000) - 200) < 1e-9);
  assert.equal(roiAtHorizon(local, other, 0), null);
});

test('series: tasks served divide by the efficiency factor', () => {
  const base = tasksServed(10, 0, 12, 1);
  assert.ok(Math.abs(base - 10 * 365) < 1);
  const eff = tasksServed(10, 0, 12, 1.21);
  assert.ok(Math.abs(eff - base / 1.21) < 1e-9);
});
