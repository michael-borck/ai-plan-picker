// units.js: the single place where unit-conversion constants live.
// CLAUDE.md allowed list: 0, 1, 2, 100, unit conversions (seconds per hour,
// hours per day, days per week, weeks and months per year, bits per byte,
// 1000, 1e6) plus horizon limits that are part of the spec's units.
// No other engine module may contain numeric literals outside this list.

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const HUNDRED = 100;

export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_HOUR = 3600;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_YEAR = 52;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = 365;
export const DAYS_PER_MONTH = DAYS_PER_YEAR / MONTHS_PER_YEAR;
export const WEEKS_PER_MONTH = WEEKS_PER_YEAR / MONTHS_PER_YEAR;

export const HORIZON_YEARS_MAX = 5;
export const HORIZON_MONTHS_MAX = HORIZON_YEARS_MAX * MONTHS_PER_YEAR;

export const SIM_STEP_MINUTES = 5;
export const SIM_STEPS_PER_HOUR = MINUTES_PER_HOUR / SIM_STEP_MINUTES;

export const WATTS_PER_KILOWATT = 1000;
export const CENTS_PER_DOLLAR = 100;
export const TOKENS_PER_MILLION = 1e6;
export const BITS_PER_BYTE = 8;
// One billion bytes is exactly one GB in this model, so weights in GB are
// params_B * bits_per_weight / 8 without any further scaling.
export const GB_PER_BILLION_PARAM_BYTES = 1;
export const MEGABYTES_PER_GB = 1000;

// A Standard Query is defined per thousand tokens of context (spec 6.1).
export const KILO = 1000;

// Tolerance for comparing accumulated floating-point sums (coverage, series
// totals). Arithmetic tolerance, not a model parameter.
export const SUM_EPSILON = 1e-9;
