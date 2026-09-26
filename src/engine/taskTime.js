// taskTime.js: task completion feasibility (spec 2.1 "cost per successful
// task, at the quality you need, with the availability you need").
//
// TCO counts tokens served; this module asks the user's actual question:
// can a meaningful task from my mix be FINISHED in one working session, and
// how many such tasks fit in a day? A cheap option that cannot finish the
// task is not a plan, it is a waiting room.
//
// For subscriptions a task bigger than one window's allowance forces a
// mid-task pause: you wait for the reset window, then continue. Pause time
// is (windows needed - 1) x window length.

import { pval } from './params.js';
import { SECONDS_PER_MINUTE, SECONDS_PER_HOUR, ONE, ZERO } from './units.js';

// The biggest task in the current mix is the representative "meaningful task".
export function representativeTask(tasks) {
  let big = null;
  for (const t of tasks) {
    const size = t.input_tokens + t.output_tokens;
    if (!big || size > big.input_tokens + big.output_tokens) big = t;
  }
  return big;
}

// Completion profile for one task on one option.
// speed: { gen_tps (decode or burst), prefill_tps } for the option;
// ttft_s: time to first token (cloud) or derived prefill (local);
// allowance_per_window / window_h: subscription only (null elsewhere).
export function taskCompletion(config, { task_in, task_out, thinking_mult, efficiency, gen_tps, ttft_s, allowance_per_window, window_h }) {
  const tokens = task_in + task_out * thinking_mult * efficiency;
  const genS = task_out * thinking_mult / gen_tps + ttft_s;

  let windowsNeeded = ONE;
  let pauseS = ZERO;
  if (allowance_per_window != null && allowance_per_window > ZERO) {
    windowsNeeded = Math.max(ONE, Math.ceil(tokens / allowance_per_window));
    const windowH = window_h != null ? window_h : pval(config, 'subscriptions.window_h');
    pauseS = (windowsNeeded - ONE) * windowH * SECONDS_PER_HOUR;
  }

  const toleranceS = pval(config, 'tasks.session_tolerance_min') * SECONDS_PER_MINUTE;
  const wallS = genS + pauseS;

  return {
    tokens,
    gen_s: genS,
    windows_needed: windowsNeeded,
    pause_s: pauseS,
    wall_s: wallS,
    // Feasible when the task finishes within the session tolerance: no
    // multi-hour mid-task resets, no days-long token drip.
    fits_session: wallS <= toleranceS,
    tolerance_s: toleranceS
  };
}

// Plain-language verdict for the plan cards and the table.
export function taskVerdict(check) {
  if (!check) return null;
  if (check.pause_s > ZERO) {
    return 'Stalls mid-task: needs ' + check.windows_needed + ' windows, about ' +
      (check.pause_s / SECONDS_PER_HOUR).toFixed(1) + ' h of reset waiting.';
  }
  if (!check.fits_session) {
    return 'Too slow: about ' + Math.round(check.wall_s / SECONDS_PER_MINUTE) +
      ' min to finish one task against a ' + Math.round(check.tolerance_s / SECONDS_PER_MINUTE) + ' min tolerance.';
  }
  const mins = check.wall_s / SECONDS_PER_MINUTE;
  return 'Finishes a task in about ' + (mins >= 1 ? Math.round(mins) + ' min' : Math.round(check.wall_s) + ' s') + '.';
}
