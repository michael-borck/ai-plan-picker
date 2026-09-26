// timeSeries.js: monthly cumulative TCO, price changes, discount rate, GST,
// break-even, payback, ROI (spec 6.13, 6.14).
//
// Series run months 0 to 60 for every option. Cumulative TCO is total cost of
// access for rented, subscription and API options; the same term is used for
// local so the lines are comparable.

import { pval } from './params.js';
import { HORIZON_MONTHS_MAX, MONTHS_PER_YEAR, DAYS_PER_MONTH, ZERO, ONE, HUNDRED } from './units.js';

function pow12(base, month) {
  return Math.pow(base, month / MONTHS_PER_YEAR);
}

// Build cumulative TCO series. desc is one of:
//   { kind: 'local', capex_aud, setup_aud, idle_energy_aud_day, busy_energy_aud_day,
//     reserve_aud_month, admin_aud_month, demand_charge_aud_month, life_months,
//     residual_on, growth }
//   { kind: 'metered', daily_aud, growth, price_change }        (API tokens)
//   { kind: 'hours',   daily_aud, price_change }                (rented hours)
//   { kind: 'flat',    monthly_aud, price_change }              (seats, monthly rental)
// opts: { months, discount_rate, gst_multiplier, hardware_price_change,
//         electricity_price_change, residual_share }
export function cumulativeTco(config, desc, opts = {}) {
  const months = opts.months != null ? opts.months : HORIZON_MONTHS_MAX;
  const discount = opts.discount_rate != null ? opts.discount_rate : ZERO;
  const gst = opts.gst_multiplier != null ? opts.gst_multiplier : ONE;
  const hwChange = opts.hardware_price_change != null ? opts.hardware_price_change : pval(config, 'price_change.hardware_per_year');
  const elecChange = opts.electricity_price_change != null ? opts.electricity_price_change : pval(config, 'price_change.electricity_per_year');
  const residualShare = opts.residual_share != null ? opts.residual_share : ZERO;

  const nominal = new Array(months + ONE).fill(ZERO);
  const pv = new Array(months + ONE).fill(ZERO);

  // Upfront at month 0 (spec 6.14: for local it starts at -capex on the net
  // saving view; the cumulative TCO itself starts at capex).
  let cum = ZERO;
  let cumPv = ZERO;
  if (desc.kind === 'local') {
    cum += (desc.capex_aud + desc.setup_aud) * gst;
  }
  if (desc.upfront_aud) cum += desc.upfront_aud * gst;
  cumPv += cum;
  nominal[ZERO] = cum;
  pv[ZERO] = cumPv;

  for (let m = ONE; m <= months; m++) {
    let flow = ZERO;
    if (desc.kind === 'local') {
      // Energy figures are per day; convert to the month (spec 6.8 energy/day).
      const energy = (desc.idle_energy_aud_day + desc.busy_energy_aud_day * pow12(ONE + desc.growth, m)) * pow12(ONE + elecChange, m) * DAYS_PER_MONTH;
      flow = energy + desc.reserve_aud_month + desc.admin_aud_month + desc.demand_charge_aud_month;

      // Repurchase at end of life if the horizon is longer (spec 6.8).
      const isRepurchase = desc.life_months != null && m % desc.life_months === ZERO && m < months;
      if (isRepurchase) flow += desc.capex_aud * pow12(ONE + hwChange, m);

      // Residual when enabled: credited when a box retires, and at the horizon
      // for the box still in service.
      if (residualShare > ZERO && desc.life_months != null) {
        if (m % desc.life_months === ZERO) flow -= residualShare * desc.capex_aud * pow12(ONE + hwChange, m);
        else if (m === months && months % desc.life_months !== ZERO) flow -= residualShare * desc.capex_aud * pow12(ONE + hwChange, m);
      }
    } else if (desc.kind === 'metered') {
      flow = desc.daily_aud * DAYS_PER_MONTH * pow12(ONE + desc.growth, m) * pow12(ONE + desc.price_change, m);
    } else if (desc.kind === 'hours') {
      flow = desc.daily_aud * DAYS_PER_MONTH * pow12(ONE + desc.price_change, m);
    } else {
      flow = desc.monthly_aud * pow12(ONE + desc.price_change, m);
    }

    // Flat additions such as costed waiting time (spec 2.7) carry no growth
    // or price escalation of their own.
    if (desc.extra_monthly_aud) flow += desc.extra_monthly_aud;

    // Pay-as-you-go top-up (spec 6.11a): metered monthly, growing with
    // demand and falling with API prices, like the API options.
    if (desc.topup_monthly_aud) {
      flow += desc.topup_monthly_aud
        * pow12(ONE + (desc.topup_growth != null ? desc.topup_growth : ZERO), m)
        * pow12(ONE + (desc.topup_price_change != null ? desc.topup_price_change : ZERO), m);
    }

    flow *= gst;
    cum += flow;
    cumPv += flow / Math.pow(ONE + discount, m / MONTHS_PER_YEAR);
    nominal[m] = cum;
    pv[m] = cumPv;
  }

  return { months, nominal, pv };
}

// TCO at a year boundary (nominal), e.g. years 1 to 5 for the table.
export function tcoAtYear(series, years) {
  return series.nominal[Math.min(years * MONTHS_PER_YEAR, series.months)];
}

// Break-even: the first month where A's cumulative TCO falls to or below B's,
// equivalently where cumulative net saving of A vs B first reaches zero
// (spec 6.14, test T18). Returns null when the lines do not cross within the
// series ("not within 5 years").
export function breakEvenMonth(seriesA, seriesB) {
  for (let m = ZERO; m <= seriesA.months; m++) {
    if (seriesA.nominal[m] <= seriesB.nominal[m]) return m;
  }
  return null;
}

// ROI at horizon: net saving vs a reference option divided by the local capex,
// a single percentage (spec 6.14). Only meaningful when the option of interest
// is the local purchase.
export function roiAtHorizon(seriesLocal, seriesOther, capex_aud) {
  if (!(capex_aud > ZERO)) return null;
  const saving = seriesOther.nominal[seriesOther.months] - seriesLocal.nominal[seriesLocal.months];
  return saving / capex_aud * HUNDRED;
}

// Total tasks served over the horizon with demand growth, divided by the
// efficiency factor (spec 6.14: cost per successful task).
export function tasksServed(sq_per_day, growth, months, efficiency) {
  let sq = ZERO;
  for (let m = ONE; m <= months; m++) {
    sq += sq_per_day * DAYS_PER_MONTH * pow12(ONE + growth, m);
  }
  if (!(efficiency > ZERO)) return sq;
  return sq / efficiency;
}

// Add metered top-up (spec 6.11a) to an existing cumulative series in place:
// a monthly cost that grows with demand and falls with API prices, GST
// applied. Used when the top-up is computed after the option's own series.
export function addMeteredTopup(series, { monthly_aud, growth, price_change, discount_rate, gst_multiplier }) {
  const gst = gst_multiplier != null ? gst_multiplier : ONE;
  const disc = discount_rate != null ? discount_rate : ZERO;
  let running = ZERO;
  let runningPv = ZERO;
  for (let m = ONE; m <= series.months; m++) {
    const inc = monthly_aud * pow12(ONE + growth, m) * pow12(ONE + price_change, m) * gst;
    running += inc;
    runningPv += inc / Math.pow(ONE + disc, m / MONTHS_PER_YEAR);
    series.nominal[m] += running;
    series.pv[m] += runningPv;
  }
}

// Add a flat monthly cost to an existing cumulative series in place (used
// for costed waiting time after top-up hours are known).
export function addFlatMonthly(series, monthly_aud, { discount_rate, gst_multiplier }) {
  const gst = gst_multiplier != null ? gst_multiplier : ONE;
  const disc = discount_rate != null ? discount_rate : ZERO;
  let running = ZERO;
  let runningPv = ZERO;
  for (let m = ONE; m <= series.months; m++) {
    const inc = monthly_aud * gst;
    running += inc;
    runningPv += inc / Math.pow(ONE + disc, m / MONTHS_PER_YEAR);
    series.nominal[m] += running;
    series.pv[m] += runningPv;
  }
}
