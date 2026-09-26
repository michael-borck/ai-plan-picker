// rental.js: rented GPU classes and costs (spec 6.9, 11.6).
// class      = smallest rental class holding the model on GPU (override allowed)
// hourly/day = (span or busy hours + overhead x sessions) x rate x FX + storage/30
// monthly    = fee x FX + misc x FX

import { pval } from './params.js';
import { DAYS_PER_MONTH, BITS_PER_BYTE } from './units.js';
import { singleStreamSpeed } from './speed.js';

export function rentalClassById(config, id) {
  const c = config.rental_classes.find(x => x.id === id);
  if (!c) throw new Error('Unknown rental class: ' + id);
  return c;
}

// Smallest class whose VRAM holds the model on GPU, using the same usable
// share as local GPU-only placement (spec 6.9).
export function smallestRentalClass(config, required_gb) {
  const usableShare = pval(config, 'memory.gpu_usable_share');
  const fits = config.rental_classes
    .filter(c => required_gb <= c.vram_gb * usableShare)
    .sort((a, b) => a.vram_gb - b.vram_gb);
  return fits.length ? fits[0] : null;
}

function classBandwidth(config, cls) {
  if (cls.bw_gbs != null) return cls.bw_gbs;
  const base = config.rental_classes.find(c => c.id === 'rtx24');
  return base.bw_gbs * pval(config, 'rental.bandwidth_48_share');
}

// Decode and prefill speed on a rented card (GPU-only placement, rental eta).
export function rentalSpeed(config, cls, { active_b, bits_per_weight, moe }) {
  const bw = classBandwidth(config, cls);
  const usable = cls.vram_gb * pval(config, 'memory.gpu_usable_share');
  const speed = singleStreamSpeed(config, {
    placement: 'gpu_only',
    generation: 'modern',
    vram_usable_gb: usable,
    bw_gpu_gbs: bw,
    eta_mid: pval(config, 'rental.eta'),
    bw_ram_gbs: 0,
    n_gpu: cls.layer_split ? 2 : 1,
    // Weights exactly fill the card so the GPU share is 1 by construction.
    weights_gb: usable,
    kv_gb: 0,
    runtime_gb: 0,
    active_params_b: active_b,
    bits_per_weight,
    moe
  });
  return { bw_gbs: bw, ...speed };
}

function rateMid(cls, lowKey, highKey) {
  return (cls[lowKey] + cls[highKey]) / 2;
}

// Hourly rental, AUD per day (spec 6.9). FX is a parameter (CLAUDE.md).
export function hourlyAudPerDay(config, cls, { hours, sessions, fx }) {
  const overhead = pval(config, 'rental.session_overhead_h');
  const rateUsd = rateMid(cls, 'hourly_usd_low', 'hourly_usd_high');
  const storageUsdDay = pval(config, 'rental.storage_usd_month') / DAYS_PER_MONTH;
  const billedH = hours + overhead * sessions;
  return billedH * rateUsd * fx + storageUsdDay * fx;
}

export function hourlyBandUsdPerHour(cls) {
  return { low: cls.hourly_usd_low, high: cls.hourly_usd_high, mid: rateMid(cls, 'hourly_usd_low', 'hourly_usd_high') };
}

// Reserved monthly or GPU VPS, AUD per month (spec 6.9). mode: 'reserved' | 'vps'.
export function monthlyAudPerMonth(config, cls, mode, fx) {
  const lowKey = mode === 'vps' ? 'vps_usd_low' : 'reserved_usd_low';
  const highKey = mode === 'vps' ? 'vps_usd_high' : 'reserved_usd_high';
  if (cls[lowKey] == null) return null;
  const feeUsd = rateMid(cls, lowKey, highKey);
  const miscUsd = pval(config, 'rental.misc_usd_month');
  return (feeUsd + miscUsd) * fx;
}
