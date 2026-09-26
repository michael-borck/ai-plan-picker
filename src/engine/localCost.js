// localCost.js: ownership costs (spec 6.8).
// capex, life and repurchase, reserve, residual, energy (load, idle, tariff
// periods), demand charge, admin, utilisation.

import { pval } from './params.js';
import { WATTS_PER_KILOWATT, CENTS_PER_DOLLAR, HOURS_PER_DAY, MONTHS_PER_YEAR } from './units.js';

export function tariffById(config, id) {
  const t = config.tables.tariffs.find(x => x.id === id);
  if (!t) throw new Error('Unknown tariff: ' + id);
  return t;
}

// Energy for one day in AUD. Split by tariff period: interactive busy hours
// run in the peak window, unattended work defaults to off-peak under TOU
// (spec 6.8). Idle hours split with the off-peak window share of the day.
export function energyAudPerDay(config, { load_w, idle_w, busy_h_peak, busy_h_offpeak, powered_h, pue, tariff }) {
  const rateMidAud = tariff.ckwh_mid / CENTS_PER_DOLLAR;
  const ratePeakAud = tariff.tou_available ? tariff.tou_peak_ckwh / CENTS_PER_DOLLAR : rateMidAud;
  const rateOffpeakAud = tariff.tou_available ? tariff.tou_offpeak_ckwh / CENTS_PER_DOLLAR : rateMidAud;

  const idleH = Math.max(0, powered_h - busy_h_peak - busy_h_offpeak);
  let offpeakShare = 0;
  if (tariff.tou_available) {
    const start = pval(config, 'electricity.tou_offpeak_start_hour');
    const end = pval(config, 'electricity.tou_offpeak_end_hour');
    const windowH = (HOURS_PER_DAY - start + end) % HOURS_PER_DAY;
    offpeakShare = windowH / HOURS_PER_DAY;
  }

  const kwhPeak = (busy_h_peak * load_w + idleH * (1 - offpeakShare) * idle_w) / WATTS_PER_KILOWATT;
  const kwhOffpeak = (busy_h_offpeak * load_w + idleH * offpeakShare * idle_w) / WATTS_PER_KILOWATT;
  const audPeak = kwhPeak * ratePeakAud * pue;
  const audOffpeak = kwhOffpeak * rateOffpeakAud * pue;
  const audBusyPeak = busy_h_peak * load_w / WATTS_PER_KILOWATT * ratePeakAud * pue;
  const audBusyOffpeak = busy_h_offpeak * load_w / WATTS_PER_KILOWATT * rateOffpeakAud * pue;

  return {
    aud_per_day: audPeak + audOffpeak,
    aud_per_day_peak: audPeak,
    aud_per_day_offpeak: audOffpeak,
    aud_per_day_busy: audBusyPeak + audBusyOffpeak,
    aud_per_day_idle: (audPeak + audOffpeak) - (audBusyPeak + audBusyOffpeak),
    kwh_per_day: kwhPeak + kwhOffpeak,
    idle_h_per_day: idleH,
    offpeak_idle_h_per_day: idleH * offpeakShare
  };
}

// Repair reserve per year, weighted by the secondhand/new split of the build
// cost (spec 6.8: 5% secondhand, 2% new).
export function reserveAudPerYear(config, { secondhand_aud, new_aud }) {
  return secondhand_aud * pval(config, 'ownership.reserve_secondhand')
    + new_aud * pval(config, 'ownership.reserve_new');
}

export function lifeMonthsFor(config, platform) {
  const years = platform.market === 'secondhand'
    ? pval(config, 'ownership.life_secondhand_years')
    : pval(config, 'ownership.life_new_years');
  return years * MONTHS_PER_YEAR;
}

export function demandChargeAudPerMonth(config, { peak_w, pue, tariff }) {
  if (tariff.id !== 'contestable') return 0;
  const peakKw = peak_w / WATTS_PER_KILOWATT * pue;
  return peakKw * pval(config, 'electricity.demand_charge_aud_per_kw_month');
}

// Admin cost per month for owned or rented hardware you operate yourself
// (spec 6.8, 6.9). Single user defaults to DIY at zero (spec 3.1).
export function adminAudPerMonth(config, { hours_per_month, rate_aud_per_hour }) {
  return hours_per_month * rate_aud_per_hour;
}

export function utilisation(busy_h, powered_h) {
  if (powered_h <= 0) return 0;
  return busy_h / powered_h;
}
