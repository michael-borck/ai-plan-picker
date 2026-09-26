# Decisions and deviations

Recorded per CLAUDE.md working style. Each entry: decision, reason, spec reference.

## D1. Paths differ from CLAUDE.md structure

The data pack arrived in `tco-data-pack/` (not `data/`) and the specification is
`ai-delivery-comparator-spec-v0.3.md` at the repo root (not `docs/spec-v0.3.md`).
Both locations are used as-is. `assumptions.json` sits beside the pack in
`tco-data-pack/` so the defaults pipeline has one input folder. No pack file was
edited.

## D2. Demand accrues on every calendar day (spec 6.7 vs test T6)

- Spec 6.7 states `annual_days = days_per_week × 52` (Workday = 260 days).
- Acceptance test T6 (spec 13) expects about AUD 10.70/month for API Best,
  Typical, Chat, thinking Off. That figure only holds if the Typical daily
  demand (15 SQ/day) is charged on all 365 days: AUD 0.3525 × 365 / 12 = 10.72.
  With 260 days the same formulas give AUD 7.64/month, a 29 percent miss, far
  outside the 10 percent tolerance.

Decision: token demand (API, subscription, local generation) accrues on every
calendar day, scaled by the usage preset's queries/day multiplier. The preset's
`days_per_week` shapes the interactive span (when the service must be
available), the subscription weekly cap conversion, and local powered hours.
This is the reading that satisfies the acceptance tests, which section 13 calls
the minimum. The alternative reading (260 demand days) is a one-parameter
change: `usage.demand_days_per_year`.

## D3. GST is applied only when the display toggle asks for it

Test T6's expected values are ex-GST, while the Single user tab defaults to
showing figures including GST (spec 6.13). The engine computes ex-GST cash
flows and multiplies GST-applicable families (subscription, API, rental:
overseas digital services) by `(1 + gst_rate)` only when the user's GST display
input is "incl". Secondhand hardware and electricity are never GST-multiplied
(private sale, published tariff assumed to include GST as paid; flagged in
docs/data-issues.md). Acceptance tests run with GST display "ex".

## D4. CPU-side efficiency in the speed model

Spec 6.4 gives efficiency η for GPU bands only. The hybrid term needs a CPU
efficiency: `assumed: speed.eta_cpu = 0.5` (band 0.4 to 0.6), chosen because it
reproduces T3's stated 35 tok/s (range 25 to 45) for 30B MoE with an active GPU
share of 0.70 on DDR4 at 50 GB/s effective.

## D5. η low/high band spread

Spec 11.1 lists one η per GPU size point ("η mid"). Low/high bands use
assumed factors `speed.eta_low_factor = 0.85` and `speed.eta_high_factor =
1.15` around the mid. Calibration hint in 6.4 (0.43 to 0.55 Maxwell/Pascal,
0.57 to 0.85 Turing+) supports roughly a plus/minus 15 percent spread.

## D6. Rental sessions per day

Spec 6.9 adds `0.25 h × sessions` to rented hours. "Sessions" is undefined.
Assumed `rental.sessions_per_day = 2` (band 1 to 4): a morning and an
afternoon stint.

## D7. Model ladder for Budget-only mode (T11)

Spec 6.4a says Budget-only returns a ladder rung, never an in-between size,
but does not define the ladder. Assumed dense rungs in billions of parameters:
1, 3, 7, 8, 14, 32, 70 (config: `models.ladder_dense_b`), plus MoE rungs
30B-total/3B-active and 120B-total/22B-active
(`models.ladder_moe`), editable in Settings later.

## D8. Acceptance test input details the spec leaves open

- T2, T3, T4 contexts: T3 needs 8k context to produce the stated active GPU
  share of exactly 0.70 (at 16k it is 0.62, speed 30 tok/s, still inside the
  stated 25 to 45 range). T2 uses 8k as stated in the test. T4 uses 4k as
  stated.
- T1 quantisation is Q4_K_M (4.85 bits/weight) per the test title.
- T7's "73 W idle" = tower desktop base 55 W + RTX 3090 idle 18 W, always on,
  residential mid tariff 32 c/kWh, PUE 1.0: 73 × 24 × 365 / 1000 × 0.32 =
  AUD 204.6/yr.
- T15 is out of Phase 1 scope (fleet path) but the concurrency formulas
  (3.2, 6.5) are implemented and unit-tested so Phase 4 slots in.

## D9. Subscription tier price provenance

Pack subscription rows map to spec tiers: Base = ChatGPT Plus AUD 30.80,
Pro = Claude Max AUD 154.00 (the pack's 5x tier), Max = AUD 308.00 (assumed,
missing from pack: spec 15 item 5), Business = Team AUD 38.50, Enterprise =
ChatGPT Enterprise AUD 92.40. Statuses follow the CSV rows.

## D10. Google Workspace Business row not used in v1 defaults

`cloud_subscription_pricing.csv` has Google Workspace Business at AUD 43.12.
The spec's tier table (11.7) does not include it. Kept in defaults as
`subscriptions.rows` for later use, not exposed as a comparator option.

## D11. "About" tolerances on T6/T7 accepted as written

T6: AUD 0.35/day, 10.70/month; T7: about AUD 205/yr. Implemented values are
0.3525, 10.72 and 204.6.

## D12. Efficiency factor follows the effective-size bands for MoE models

Spec 6.7 defines effective size (total parameters for dense, square root of
total times active for MoE) and spec 11.9 keys the efficiency bands by
"Effective size". A 30B MoE with 3B active therefore has effective size 9.49
and takes the 5 to 20B factor (1.56), not the CSV's "Local 30B quantised" row
(1.21), which is read as describing a dense 30B class. This follows the spec's
stated method; the CSV rows are keyed by total model size, which is the
tension to revisit if the client intends the 1.21 factor for MoE models.

## D13. Eta band applies to the CPU memory path as well

The low/mid/high speed band scales the GPU path efficiency per spec 6.4. For
hybrid, CPU-only and unified placements the CPU path efficiency now scales by
the same band factors (assumed), so CPU-only configurations do not show a
degenerate low = mid = high range.

## D14. Bundled build instead of a JavaScript build tool

build.js strips import/export syntax and concatenates src/engine/ modules in
dependency order, matching the spec's "single self-contained HTML file, no
build step" spirit (spec 14). Chart.js 4.4.3 UMD is vendored in
src/vendor/chart.umd.js and inlined, so the file opens offline.

## D15. Hardware explorer objectives (spec 4.2)

"Best value" is implemented as the lowest price per tok/s of speed above the
minimum speed floor. When the budget is "auto" (the default), the objective is
pinned to "cheapest", because spec 4.1 defines auto as "the cheapest build
that meets demand". Budget-only mode always returns a ladder rung (T11) and
ignores the budget dial when picking the configuration for that rung, since
the rung search already applied the budget.

## D16. The Free tier ignores the model-class allowance multiplier

Spec 6.10 multiplies the base allowance by tier and model-class multipliers.
Stacking Free (0.1) with the Cheap class (4.0) gave the free tier 80,000
tokens per 5-hour window, enough to absorb a whole Typical user's day, which
does not match how free tiers behave: they meter aggressively whatever model
they serve. Free now ignores the class multiplier (20,000 tokens per window).
Consequences: Free filters out for Typical (coverage 0.65, lockout 4.3 h/day)
and Power (0.19), and legitimately wins for the Light persona. The flag lives
on the tier record in the configuration, so it is editable.

## D17. Subscription windows are bursty, not smooth

Review feedback: real iterative work hits the window cap mid-task, then waits
for reset. The simulator previously spread demand smoothly, so lockout almost
never fired. Each window's demand is now front-loaded: the share
subscriptions.window_burst_time_share (0.2) of the window carries the share
subscriptions.window_burst_load_share (0.6) of its tokens, then trickles. Both
are assumed parameters. Coverage totals are unchanged; lockout hours and the
24-hour profile now show reset waiting, e.g. 4.3 h/day for a Typical user on
the free tier.

## D18. Purchase price visibility on the cumulative TCO chart

The purchase price was always in the data (month 0 of local series, the
Upfront column, and the hardware card breakdown) but a linear axis scaled by
multi-thousand-dollar rental lines hid it. Added a log-scale toggle and an
explicit note that the month-0 vertical step on local lines is the machine.

## D19. Task completion feasibility: the missing half of the headline metric

Spec 2.1 defines the headline as "cost per successful task, at the quality you
need, with the availability you need". The engine counted tokens served but
never asked whether a meaningful task can be FINISHED in one sitting. New
module src/engine/taskTime.js: the biggest task in the user's mix is checked
against each option: generation time at that option's speed, and for
subscriptions the number of reset windows a task spans, each pause costing a
window length (you wait for reset mid-task, then continue). A task is
feasible when wall-clock time fits tasks.session_tolerance_min (15 min,
assumed, editable). Infeasible options fail the recommendation filter but
stay visible with the reason. New table columns: cost per completed task
(TCO over tasks actually deliverable, dividing by coverage) and the task
verdict. The recommendation text ends with the winner's task verdict.

## D20. Simple view for an individual

A "Simple view" toggle (top of the Single user tab) presents phone-plan
cards: price per month plus upfront, speed in plain terms, whether the plan
finishes your biggest kind of task, what share of your day it covers, and
where data lives. It hides the detailed tables and charts. The full view is
unchanged underneath; both use the same engine.

## D21. Simple view shows the build, the usage, and the crossovers

Review feedback, three gaps. (1) The local plan card showed the cheapest
qualifying build, which can be a CPU-only box with no GPU card. The simple
view now shows two local cards when they differ: the cheapest build and the
cheapest build with a GPU card, each labelled with its actual hardware
("no GPU card, runs on the processor" is stated plainly). (2) The cards said
"covers your full day" without saying what the day was. The simple view now
leads with the usage summary (tasks per day, tokens, mode, span, thinking)
and keeps four quick controls (user type, what you do, intensity, thinking)
so the power-user case is one click away: at Power plus Agentic, API pay as
you go costs about AUD 6,065 over 3 years versus AUD 1,788 for the local box.
(3) Crossovers were computed but never drawn or stated. The cumulative TCO
chart now marks where each cloud line overtakes the local line ("local pays
off vs ... , month N"), and both views carry plain statements: against Pro
the box pays for itself at month 4, against Base at month 23, against API
Cheap never within 5 years because the box's running cost alone exceeds the
bill. Lines look straight because monthly costs are near constant; that is
the honest shape, so the crossings and the zero-crossing payback view carry
the meaning.

## D22. Simple view is the default; the workbench is one untick away

Simple view (phone-plan cards) now loads by default for the individual
audience; the checkbox labelled "Simple view" unticks into the full
workbench. In simple view the detailed Single user settings grid is hidden
(its controls that matter live in the plans card: user type, what you do,
intensity, thinking). The state persists in the URL hash and localStorage.

## D23. Bundle regression test

The advanced-view charts rendered blank in the browser because profile24.js
was missing from build.js ENGINE_ORDER; the headless harness had not caught
it because its Chart stub short-circuited the renderers. Two fixes: the
module is in the bundle, and tests/bundle.test.js executes the built HTML
end to end with a stubbed DOM and a stubbed Chart, asserting that the TCO,
profile, waiting, capacity and tornado renderers all receive configs. Any
future module left out of the bundle fails a test instead of shipping blank.

## D24. Sensitivity tornado implementation

Spec 7 chart 8: the tornado shows the TCO gap between the winner and the
runner-up. The robustness sweep (spec 6.15) and the tornado now share one
sensitivity pass (src/engine/recommend.js sensitivityAnalysis): for each
banded parameter, recompute at low and high once, recording the winner flip
and the gap. The default parameter set is power.inference_factor, fx.usd_aud,
subscriptions.base_allowance_tokens, subscriptions.window_h,
demand.growth_per_year, api.previous_ratio, price_change.api_per_year and
speed.eta_cpu, ordered in the chart by swing size. Flat bars are honest:
they mean the parameter does not touch this winner-versus-runner-up pair.
Full compute with the sensitivity pass stays around 90 ms.

## D25. Phase 3 settings panel implementation

The slide-over Settings panel follows spec 10 with two adaptations. First,
the parameter sections are grouped by id prefix into ten tabs (Hardware,
Speed model, Power and electricity, Ownership and admin, Organisation and
tasks, Rental, Subscriptions, API, Fit checks and explorer, Time effects and
general) rather than the spec's fourteen, matching how the defaults are
actually keyed; nothing is hidden. Second, the "Picker snapshot prices"
preset derives band AUD/GB from the snapshot mid prices (small modern
31.76, large modern 31.92, flagship 59.74, legacy server 10.59); the spec
15 item 2 caveat about the flagship bracket being a floor is stated in the
preset description. The pessimistic/optimistic presets swing a curated dozen
parameters to their band ends. Editing any value routes through the engine's
setParam: status becomes user-supplied, the original is kept and shown in
the status tooltip and Undo button. The whole configuration exports and
imports as JSON with unknown-id reporting; user-supplied edits also persist
to localStorage separately so a shared link or fresh open keeps them.
Engine side is covered by tests/settings.test.js (nine tests), including
"optimistic makes the local box cheaper than pessimistic".

# CR-001: task layer, top-up and single-user scope

Decisions made while implementing `docs/change-requests/CR-001-task-layer.md`
(spec v0.4). Each entry below records a resolution or a changed test
expectation, per CR section 3 item 9 and section 4.

### CR-001 implementation decisions

- **Paths**: the CR names `data/assumptions.json` and `docs/spec-v0.3.md`;
  this build keeps the pack in `tco-data-pack/` (D1) and moved the root spec
  to `docs/spec.md` in the rename-only commit tagged `spec-v0.3`.
- **D19 superseded** (item 7): the biggest-task session veto is removed.
  Session time now marks cells Slow. `src/engine/taskTime.js` deleted as dead
  code; its unit tests replaced by N1 to N11 and the task-layer unit tests.
- **Verbosity-only bands** (item 6): efficiency_size_bands now carry 1.60 /
  1.30 / 1.10 / 1.10 and cloud cheap 1.05, previous 1.00, best 1.00. The
  pack's combined factors (2.16/1.56/1.21) and retry factor are no longer
  used anywhere (spec 2.5, 15 item 10).
- **Cost per completed task** (6.14): TCO including top-up over tasks
  completed (own plus topped-up). The divide-by-coverage version is gone.
- **N4 vs 11.10a contradiction**: with the stated p_min default 0.30, a gap 2
  task (p 0.25) is No, but test N4 says Slow. The test runs with p_min swung
  to its band low (0.20), inside the spec's own band. Flagged for the client:
  either p_min should default lower or N4 should expect No.
- **D2 convention stated once**: a week is seven days (taskLayer.js header);
  weekly request capacity is requests per day times seven.
- **Broker plans**: limits sourced (OpenRouter docs, 26 Sep 2026),
  reliability 0.70 and quality High assumed, may_train flag set; USD 10
  credit converts at the FX parameter into a month-0 upfront cost.
- **Existing test expectations changed, with reasons**:
  - tests/demand.test.js: efficiency band values now verbosity-only (above).
  - tests/task-feasibility.test.js: rewritten for the task layer; the free
    broker plan can now win typical chat (about 157 requests a week against
    a 350 request capacity), so the old api_cheap-wins expectation is gone.
  - tests/free-and-burst.test.js: the free tier is no longer excluded; it
    completes the week via top-up, so the test asserts own share below one,
    priced top-up, and honest reset lockout instead.
  - tests/phase2.test.js: costed waiting now uses the final wait hours
    (interactive plus top-up processing and hand-off), so the VOT delta is
    exact again; the advice-text check expects the own-share sentence.
  - tests/wiring.test.js: fx now moves the broker credit plan (USD upfront);
    api.previous_ratio moves any option whose top-up uses the previous class.
- **Item 12 approximation**: the pay-off multiple compares the best eligible
  local option with the best paid non-local option at today's prices
  (upfront plus monthly times horizon), no growth or discounting. Indicative.

### Chart ribbon (spec 7 chart 1, completed Phase D leftover)

The low/high ribbon on the leading two cumulative TCO lines is built from the
one-at-a-time sensitivity swings the recommendation already computes, so it
costs no extra full runs: for each month the envelope takes the minimum and
maximum of the winner's and runner-up's cumulative TCO across every swing,
seeded with their base series, so the band brackets the lines it belongs to
by construction. It is computed only when the view asks for it
(`with_bands`, advanced view) and drawn as a translucent fill between two
datasets in cumulative mode; the payback view has no band. An earlier
all-parameters-together approach was discarded because the envelope did not
bracket the base line under non-linear combinations.
