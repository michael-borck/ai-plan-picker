// rental.js unit tests: spec 6.9, 11.6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smallestRentalClass, rentalSpeed, hourlyAudPerDay, monthlyAudPerMonth, hourlyBandUsdPerHour, rentalClassById } from '../src/engine/rental.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('rental: smallest class holding the model on GPU', () => {
  assert.equal(smallestRentalClass(config, 22).id, 'rtx24');
  assert.equal(smallestRentalClass(config, 40).id, 'dual48');
  assert.equal(smallestRentalClass(config, 70).id, 'a100_80');
  assert.equal(smallestRentalClass(config, 200), null);
});

test('rental: hourly daily cost is billed hours times rate times FX plus storage', () => {
  const cls = rentalClassById(config, 'rtx24');
  const aud = hourlyAudPerDay(config, cls, { hours: 8, sessions: 2, fx: 1.54 });
  const rate = (0.40 + 0.65) / 2;
  const expected = (8 + 0.25 * 2) * rate * 1.54 + 10 / (365 / 12) * 1.54;
  assert.ok(Math.abs(aud - expected) < 1e-9);
});

test('rental: hourly band is the class low and high', () => {
  const cls = rentalClassById(config, 'rtx24');
  const band = hourlyBandUsdPerHour(cls);
  assert.equal(band.low, 0.40);
  assert.equal(band.high, 0.65);
});

test('rental: reserved monthly includes misc fees', () => {
  const cls = rentalClassById(config, 'rtx24');
  const aud = monthlyAudPerMonth(config, cls, 'reserved', 1.54);
  const expected = ((300 + 600) / 2 + 20) * 1.54;
  assert.ok(Math.abs(aud - expected) < 1e-9);
  const h100 = rentalClassById(config, 'h100_80');
  assert.equal(monthlyAudPerMonth(config, h100, 'reserved', 1.54), null, 'H100 has no reserved row');
  assert.equal(monthlyAudPerMonth(config, h100, 'vps', 1.54), null);
});

test('rental: 48 GB class bandwidth is the 24 GB class times the share', () => {
  const cls = rentalClassById(config, 'dual48');
  const speed = rentalSpeed(config, cls, { active_b: 70, bits_per_weight: 4.85, moe: false });
  const rtx24 = rentalClassById(config, 'rtx24');
  const base = rentalSpeed(config, rtx24, { active_b: 70, bits_per_weight: 4.85, moe: false });
  assert.ok(Math.abs(speed.bw_gbs - base.bw_gbs * 0.90) < 1e-9);
});

test('rental: speed uses the rental eta on full GPU placement', () => {
  const cls = rentalClassById(config, 'rtx24');
  const speed = rentalSpeed(config, cls, { active_b: 8, bits_per_weight: 4.85, moe: false });
  assert.ok(Math.abs(speed.gpu_share - 1) < 1e-9);
  assert.ok(Math.abs(speed.decode_tps.mid - (0.70 * 1008) / 4.85) < 1e-9);
});

test('rental: layer split class is slower than single card per token', () => {
  const dual = rentalClassById(config, 'dual48');
  const rtx = rentalClassById(config, 'rtx24');
  const a = rentalSpeed(config, dual, { active_b: 70, bits_per_weight: 4.85, moe: false });
  const b = rentalSpeed(config, rtx, { active_b: 70, bits_per_weight: 4.85, moe: false });
  assert.ok(a.decode_tps.mid < b.decode_tps.mid * 0.95);
});
