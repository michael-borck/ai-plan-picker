// fitChecks.js: context window check (spec 8).
// For each task type the required context (input plus expected output plus
// thinking) is compared against each option's context window.

import { KILO, ZERO } from './units.js';

// Required context in tokens for the busiest task in a mix, with thinking.
export function requiredContextTokens(tasks, thinking_mult) {
  let max = ZERO;
  for (const t of tasks) {
    const need = t.input_tokens + t.output_tokens * thinking_mult;
    if (need > max) max = need;
  }
  return max;
}

// Compare a required context against an option's window. Local options use
// the configuration's context setting (which also drives memory); cloud
// classes use their configured window (spec 8).
export function contextCheck(window_k, required_tokens) {
  const requiredK = required_tokens / KILO;
  return {
    window_k,
    required_k: requiredK,
    pass: window_k >= requiredK
  };
}
