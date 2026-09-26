#!/usr/bin/env node
// Worked example: Single user, Typical persona, Workday, Chat, Good quality,
// 3-year horizon, on defaults. Prints a readable table for sanity-checking
// the numbers before any UI exists (kickoff prompt, Phase 1).

import { readFileSync } from 'node:fs';
import { compute } from '../src/engine/compute.js';

const config = JSON.parse(readFileSync(new URL('../src/defaults.json', import.meta.url)));

const inputs = {
  persona: 'typical',
  usage_preset: 'workday',
  usage_mode: 'chat',
  quality_target: 'good',
  horizon_years: 3
};

const t0 = Date.now();
const r = compute(config, inputs);
const ms = Date.now() - t0;

const aud = v => 'AUD ' + Math.round(v).toLocaleString('en-AU');
const num = (v, dp = 1) => (v == null || !Number.isFinite(v)) ? '-' : v.toFixed(dp);

console.log('AI Delivery Comparator: worked example');
console.log('Single user, Typical persona, Workday preset, Chat mode, Good quality, 3-year horizon');
console.log('Demand: ' + num(r.demand.sq_per_day, 0) + ' SQ/day, ' +
  Math.round(r.demand.sq_in_per_day).toLocaleString('en-AU') + ' input tokens/day, ' +
  Math.round(r.demand.sq_out_per_day).toLocaleString('en-AU') + ' output tokens/day (before thinking and efficiency)');
console.log('Cloud tokens/day: ' + Math.round(r.demand.tokens_cloud_per_day).toLocaleString('en-AU'));
console.log('');

const rows = r.options.map(o => ({
  id: o.id,
  label: o.label,
  upfront: o.upfront_aud,
  monthly: o.monthly_avg_aud,
  y1: o.tco_at_years[0],
  y3: o.tco_at_years[2],
  y5: o.tco_at_years[4],
  coverage: o.coverage,
  tps: o.per_user_tps_mid,
  wait: o.wait_hours_per_user_year,
  be: o.break_even_vs_local,
  pass: o.passes_filters && !o.sensitivity.vetoed ? 'yes' : o.sensitivity.vetoed ? 'vetoed' : 'filtered'
}));

const w = [34, 9, 9, 9, 9, 9, 6, 7, 7, 7];
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(
  pad('option', w[0]) + padL('upfront', w[1]) + padL('monthly', w[2]) +
  padL('TCO y1', w[3]) + padL('TCO y3', w[4]) + padL('TCO y5', w[5]) +
  padL('cover', w[6]) + padL('tok/s', w[7]) + padL('wait h', w[8]) + padL('BE mo', w[9]) + '  rank'
);
for (const o of rows) {
  console.log(
    pad(o.label.slice(0, w[0] - 1), w[0]) +
    padL(o.upfront ? Math.round(o.upfront) : '-', w[1]) +
    padL(num(o.monthly, 2), w[2]) +
    padL(Math.round(o.y1), w[3]) +
    padL(Math.round(o.y3), w[4]) +
    padL(Math.round(o.y5), w[5]) +
    padL((o.coverage * 100).toFixed(0) + '%', w[6]) +
    padL(num(o.tps, 0), w[7]) +
    padL(num(o.wait, 0), w[8]) +
    padL(o.be == null ? '-' : o.be, w[9]) +
    '  ' + o.pass
  );
}

console.log('');
const hw = r.hardware_card;
if (hw) {
  console.log('Local hardware card (best config):');
  console.log('  ' + hw.platform + ', ' + hw.gpu + ', ' + hw.ram_gb + ' GB ' + hw.ram_type.toUpperCase() + ', ' + hw.placement + ' placement');
  console.log('  memory: ' + num(hw.memory.required_gb, 1) + ' GB required of ' + num(hw.memory.capacity_gb, 1) + ' GB available');
  console.log('  decode ' + num(hw.decode_tps.mid, 1) + ' tok/s (low ' + num(hw.decode_tps.low, 1) + ' to high ' + num(hw.decode_tps.high, 1) + '), prefill ' + num(hw.prefill_tps.mid, 0) + ' tok/s');
  console.log('  load ' + num(hw.load_w, 0) + ' W, idle ' + num(hw.idle_w, 0) + ' W, efficiency factor ' + num(hw.efficiency_factor, 2));
}

console.log('');
console.log('Recommendation:');
console.log(r.recommendation.text);
console.log('');
console.log('compute time: ' + ms + ' ms (engine budget: under 100 ms per spec 9)');
