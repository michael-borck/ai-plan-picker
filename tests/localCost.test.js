// localCost.js unit tests: spec 6.8, 11.3, 11.4, 11.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tariffById, energyAudPerDay, reserveAudPerYear, lifeMonthsFor, demandChargeAudPerMonth, adminAudPerMonth, utilisation } from '../src/engine/localCost.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('local: T7 idle box cost, 73 W always on at 32 c/kWh is about AUD 205/yr', () => {
  const tariff = tariffById(config, 'residential');
  const e = energyAudPerDay(config, {
    load_w: 73, idle_w: 73, busy_h_peak: 0, busy_h_offpeak: 0,
    powered_h: 24, pue: 1.0, tariff
  });
  const perYear = e.aud_per_day * 365;
  assert.ok(Math.abs(perYear - 205) / 205 < 0.10, 'AUD ' + perYear.toFixed(2) + '/yr, expected about 205');
});

test('local: T7 breakdown is 73 W x 24 h x 365 d x 0.32 AUD/kWh', () => {
  const tariff = tariffById(config, 'residential');
  const e = energyAudPerDay(config, {
    load_w: 73, idle_w: 73, busy_h_peak: 0, busy_h_offpeak: 0,
    powered_h: 24, pue: 1.0, tariff
  });
  assert.ok(Math.abs(e.aud_per_day - 73 * 24 / 1000 * 0.32) < 1e-9);
});

test('local: load hours use the load watts, not idle watts', () => {
  const tariff = tariffById(config, 'residential');
  const e = energyAudPerDay(config, {
    load_w: 320, idle_w: 73, busy_h_peak: 2, busy_h_offpeak: 0,
    powered_h: 24, pue: 1.0, tariff
  });
  const expected = (2 * 320 + 22 * 73) / 1000 * 0.32;
  assert.ok(Math.abs(e.aud_per_day - expected) < 1e-9);
});

test('local: TOU splits idle hours by the off-peak window', () => {
  const tou = tariffById(config, 'small_business_tou');
  assert.ok(tou.tou_available);
  const e = energyAudPerDay(config, {
    load_w: 300, idle_w: 100, busy_h_peak: 0, busy_h_offpeak: 0,
    powered_h: 24, pue: 1.0, tariff: tou
  });
  // Off-peak window 21:00 to 07:00 = 10 hours = 10/24 of the idle day.
  const offpeakHours = 24 * (10 / 24);
  const expected = offpeakHours * 100 / 1000 * 0.16 + (24 - offpeakHours) * 100 / 1000 * 0.48;
  assert.ok(Math.abs(e.aud_per_day - expected) < 1e-9);
});

test('local: unattended busy hours are billed off-peak under TOU', () => {
  const tou = tariffById(config, 'small_business_tou');
  const e = energyAudPerDay(config, {
    load_w: 300, idle_w: 100, busy_h_peak: 1, busy_h_offpeak: 5,
    powered_h: 24, pue: 1.0, tariff: tou
  });
  assert.ok(e.aud_per_day_busy > 0);
  const busyExpected = 1 * 300 / 1000 * 0.48 + 5 * 300 / 1000 * 0.16;
  assert.ok(Math.abs(e.aud_per_day_busy - busyExpected) < 1e-9);
});

test('local: reserve is 5 percent secondhand, 2 percent new, weighted', () => {
  const r = reserveAudPerYear(config, { secondhand_aud: 1000, new_aud: 500 });
  assert.ok(Math.abs(r - (1000 * 0.05 + 500 * 0.02)) < 1e-9);
});

test('local: life is 4 years secondhand, 5 new', () => {
  const tower = config.platforms.find(p => p.id === 'tower_desktop');
  const desktop = config.platforms.find(p => p.id === 'new_desktop');
  assert.equal(lifeMonthsFor(config, tower), 48);
  assert.equal(lifeMonthsFor(config, desktop), 60);
});

test('local: demand charge only on contestable tariff', () => {
  const contestable = tariffById(config, 'contestable');
  const residential = tariffById(config, 'residential');
  assert.ok(demandChargeAudPerMonth(config, { peak_w: 1000, pue: 1.4, tariff: contestable }) > 0);
  assert.equal(demandChargeAudPerMonth(config, { peak_w: 1000, pue: 1.4, tariff: residential }), 0);
});

test('local: admin is hours times rate', () => {
  assert.ok(Math.abs(adminAudPerMonth(config, { hours_per_month: 2, rate_aud_per_hour: 120 }) - 240) < 1e-9);
  assert.equal(adminAudPerMonth(config, { hours_per_month: 0, rate_aud_per_hour: 120 }), 0);
});

test('local: utilisation is busy over powered', () => {
  assert.ok(Math.abs(utilisation(2, 24) - 2 / 24) < 1e-9);
  assert.equal(utilisation(2, 0), 0);
});
