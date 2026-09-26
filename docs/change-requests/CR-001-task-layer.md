# CR-001: Task layer, top-up and single-user scope

**Status:** Approved for implementation
**Date:** 26 September 2026
**Requested by:** Michael Borck
**Spec:** `docs/spec.md` v0.4. Authoritative sections: 0 (v0.3 to v0.4), 1.3, 2.1, 2.5, 2.8, 4.4, 6.7, 6.10, 6.10a, 6.11a, 6.14, 6.15, 7, 11.7, 11.10a, 11.11, 13.1, 15 item 10. Read them with `git diff spec-v0.3 -- docs/spec.md`.
**Reference:** `docs/reference/plan-picker-engine.reference.js` (concepts only, never copied or imported).

---

## 1. Why

The current build judges each option on one "biggest task" and excludes any option that cannot finish it within 15 minutes (D19). It still measures coverage as tokens per day. This gets real cases wrong:

- An option that does 90% of someone's week is excluded because of one large task. An option that passes the biggest task is never checked against the others (for example agent tools, or a long context).
- Nothing shows that "free for small things plus pay-as-you-go for the rest" is often the cheapest real answer, because failures are excluded rather than costed.
- The agentic task is treated as 300k fresh input tokens, so local machines are charged for reprocessing context that agent frameworks reuse (a 12 GB + RAM build shows about 40 minutes per task instead of about 13).
- Weaker models are penalised twice: once by the efficiency factor's retry part and again by the retry factor.
- Request-limited free services (broker free models) are not modelled at all.

The fix is to make the **task** the unit of work, check every task type against every option, and top up what an option cannot do so every TCO is for the same completed week.

## 2. Scope

**Must**

1. Task layer: gates, per-task quantities, status and reasons for every task type × option (spec 2.8).
2. Weekly capacity with smallest-first fill, and own share by work size (2.8).
3. Request-limited plans (6.10a, 11.7).
4. Pay-as-you-go top-up folded into each option's TCO series (6.11a).
5. Success rates replace `retry_or_rerun_factor`; verbosity stays (2.5, 11.10a).
6. Remove the D19 biggest-task veto from eligibility (6.15).
7. Cached input handling in local reprocessing and subscription allowance use (2.8).
8. Recommendation text additions (6.15).
9. "Can it do your week?" grid, new table columns, simple-view rules and "Use my own week" (7).
10. Hide Small business, Enterprise and Compare sizes behind `features.org_tabs = false`; remove stale "still to come" and "later phase" text (1.3).
11. Tests N1 to N11, and an updated `scripts/example.js` that prints the grid (13.1).

**Should**

12. "Pays off at about N× this workload" line in the plan advice: the smallest multiple of all task counts (from 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100) at which the best local option's TCO at the horizon is at or below the best non-local eligible option.

**Out of scope (do not start)**

- The 24-hour delivery profile (D17 front-loading stays exactly as is). Task-ordered lockouts are a later CR.
- Combinations routing matrix (6.12), fleet sizing, batching, winner map.
- Any change to hardware search, speed model, MoE handling, provenance, tornado mechanics, presets, persistence, GST or time effects, except where an item below says so.
- The reference file's `moeEff` and `moeOverheadMs`. Not part of this CR.

## 3. Work items

Numbered because they are the implementation order. One commit per item, tests passing at each commit.

### Item 0: Housekeeping

- Add to `CLAUDE.md`: "Changes arrive as change requests in `docs/change-requests/`. The spec diff named in the CR is the authority for what changes. Do not change anything a CR does not mention." Update the spec path to `docs/spec.md`.
- Add a `CR-001` heading to `docs/decisions.md` for the entries below.

### Item 1: Configuration

In `data/assumptions.json` (status `assumed` unless noted, each with a one-line reason), regenerate `src/defaults.json`:

- Task-type attributes from spec 11.11: steps, cacheable share, quality needed, needs agent tools, optional context override. The five pack tasks keep the pack's token counts. Add Agentic and Hard problem (Hard problem share 0 in every mix).
- Success rates and `p_min` (11.10a), banded as listed. `tasks.agent_tolerance_min` 120. `tasks.handoff_min` 2. `subscriptions.cache_weight` 0.1.
- Option attributes for the task layer: quality level, context window, agent tools, reliability, data flag (`may_train` or not). Free tier: context 32k, no agent tools, quality High.
- Two request-limited plan rows (11.7). Limits: status `sourced`, source "OpenRouter documentation, openrouter.ai/docs (limits)", source_date 2026-09-26. Reliability and quality: `assumed`.
- Rules: `rules.top_up` (default true), `rules.exclude_may_train` (default false). Feature flag `features.org_tabs` (default false).
- Add the new banded parameters to the tornado's parameter list: success rate at gap 1, at gap 2, `p_min`, `subscriptions.cache_weight`.

### Item 2: Task layer module

New `src/engine/taskLayer.js`, pure functions:

- `taskTypesForInputs(config, inputs)`: counts per task type from the existing demand model (D2 convention), or from "Use my own week" counts.
- `successRate(config, gap)`.
- `evaluateTask(config, task, option, inputs)`: applies gates 1 to 6 of spec 2.8 in order; returns `{status: 'yes'|'slow'|'no', reasons[], p, attempts, requests, units, api_aud, wall_s, spans}`.

`taskTime.js`: remove `representativeTask` from the eligibility path. Reuse any helpers that still fit; delete what becomes dead code.

### Item 3: Weekly capacity and fill

In `taskLayer.js` (or a sibling `weeklyFill.js`): given an option's weekly limit (hours, allowance with weekly cap, requests, or none), fill feasible tasks smallest first by units per task. Return per task type `done` and `left`, and the option's `own_share` by work size (2.8).

### Item 4: Request-limited plans

Add the plan family in `subscription.js` or a new `requestPlans.js`. Weekly requests, requests-per-minute minimum time, attempts including reliability, one-off credit as upfront cost (6.10a). Give the family its own colour and label in charts and tables.

### Item 5: Top-up

Helper in `api.js`: cheapest qualifying API class per task (all gates pass, p ≥ 0.95, sensitivity rules pass). In `compute.js`, add top-up as a metered monthly cost into each option's TCO series, with API price change and demand growth applied the same way as API options. Add `topup_monthly_aud`, `topup_tasks`, `topup_hours` to each option. With `rules.top_up` off, leftovers are reported as undone.

The existing 6.10 overflow setting (Unmet / Upgrade / Top up) is superseded by `rules.top_up` for the Single user tab. Keep its code path for the hidden org tabs; record this in `decisions.md`.

### Item 6: Retries and verbosity

Remove `retry_or_rerun_factor` from every calculation. Keep `equivalent_output_token_factor` as verbosity on output tokens. Remove the retry factor from the Settings UI (the pack row stays in `data/`, read-only). `cost_per_completed_task_aud` becomes TCO including top-up divided by tasks completed (6.14); remove the divide-by-coverage version. Record in `decisions.md` and `docs/data-issues.md` (item 10).

### Item 7: Eligibility and recommendation

In `compute.js` remove `if (!o.task_check.fits_session) o.passes_filters = false;` and supersede D19 in `decisions.md`. New eligibility: completed week (own share 100%, or 100% after top-up), local speed floor, sensitivity rules. Apply `rules.exclude_may_train` as an option-level exclusion (and in top-up choice). Recommendation text additions per spec 6.15, including the free-winner and `may_train` lines.

### Item 8: UI

- Grid "Can it do your week?" per spec 7: rows options, columns task types with counts, first column "On its own". Status in words, not colour alone. Reason, time per task, and top-up service in each cell.
- Comparison table: add "On its own" and "Top-up per month".
- Simple view: grid under plan advice; rules toggles (top-up, leave out services that may train on my data); "Use my own week" editor with a count per task type.
- Hide org tabs behind the flag. Remove stale text ("Still to come: sensitivity tornado", "Settings panel (later phase)").
- Australian English, no em dashes, existing terminology (CLAUDE.md).

### Item 9: Tests and example

- Tests N1 to N11 from spec 13.1, named by ID.
- Existing tests: change an expected value only where this CR explains why; list each change and reason in `decisions.md`.
- `scripts/example.js`: add the grid (statuses and own share per option) and top-up figures for the default Single user scenario.

## 4. Known interactions to resolve in the plan

State your resolution for each in the Step 1 plan. Proposed resolutions are given; use them unless you find a problem.

| Topic | Proposed resolution |
|---|---|
| D2 (demand accrues every calendar day) vs weekly limits | Keep D2. Convert per-day counts to per-week with the same convention used elsewhere; state it once in `taskLayer.js`. |
| D16 (free tier ignores the class multiplier) | Keep. |
| D17 (front-loaded windows, 24-hour profile) | Keep unchanged. Not part of this CR. |
| D19 (biggest-task veto) | Superseded by CR-001 item 7. |
| 6.10 overflow setting | Superseded by `rules.top_up` in Single user (item 5). |
| Existing context check (spec 8) | Replaced for eligibility by gate 1 per task; keep the table column, fed from the task layer. |
| Local quality level | From the existing capability band mapping of effective size; no new mapping. |

## 5. Do not change

Hardware search and placement, speed model and bands, memory model, provenance and parameter editing, presets, tornado mechanics (only its parameter list grows), 24-hour profile, time effects, GST, persistence and URL hash, teaching mode behaviour, chart library and build process.

## 6. Definition of done

- All tests pass, including N1 to N11 and the existing suite (with documented changes only).
- `node build.js` produces a single `dist/comparator.html` that opens offline.
- `scripts/example.js` output included in the session summary, with the grid.
- `decisions.md` and `data-issues.md` updated. No unrelated files changed (check `git diff --stat` against the branch start).
