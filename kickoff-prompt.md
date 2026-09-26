# Kickoff prompt: Session 1 (Phase 1, engine and tests)

Paste everything below the line into Claude Code, from the project root.

---

We're starting the AI Delivery Comparator. Read `CLAUDE.md` first, then `docs/spec-v0.3.md` in full, then `data/README.md` and every CSV in `data/`.

This session is **Phase 1 only: the calculation engine and tests for the single-user path, plus the defaults pipeline.** No UI, no charts, no HTML yet.

## Step 1: plan, then stop

Before writing any code, reply with:

1. The files you will create, and the spec sections each one implements.
2. How you will map each CSV column into parameter records (`id, label, value, low, high, unit, status, source, source_date, note`), and which spec defaults go into `data/assumptions.json` instead.
3. Any ambiguities or contradictions you find in the spec or the data, especially anything that would change a result. Include your proposed resolution for each.
4. Anything in the acceptance tests you think is wrong or under-specified.

Then **stop and wait for my go-ahead.**

## Step 2: build (after approval)

**Scaffold** the folder structure in `CLAUDE.md`.

**Defaults pipeline**
- `scripts/build-defaults.js`: reads `data/*.csv` and `data/assumptions.json` and writes `src/defaults.json`. It must keep status, source and date on every value. Status comes from the CSV's own `status` column: `sourced`, `estimated` (including "estimate - verify..." values) or `assumed`.
- `data/assumptions.json`: every spec section 11 default that is not in the pack, each with `status: "assumed"` and a one-line reason.
- The CSVs have quirks (Windows line endings, footer note rows, a second table inside `workload_profiles.csv`). Parse them robustly and test the parser.

**Engine modules** in `src/engine/`, all pure functions, taking `config` and returning plain objects:

| Module | Spec |
|---|---|
| `memory.js`: weights, KV cache, runtime, required GB | 6.1 |
| `hardware.js`: platforms, GPU bands priced per GB, RAM steps, unified systems | 6.2, 11.1, 11.2 |
| `configSearch.js`: enumeration and placement classes | 6.3 |
| `speed.js`: decode and prefill tok/s, MoE placement bonus, multi-GPU factor, low/mid/high bands | 6.4 |
| `select.js`: objectives, Budget-only ladders, quality-target mode, no-fit suggestions | 6.4a |
| `demand.js`: Standard Query from task mix, personas, usage presets, usage modes, efficiency factor, thinking effort, growth | 2.2, 2.3, 2.5, 2.6, 4.3, 4.4, 6.7 |
| `localCost.js`: capex, life and repurchase, reserve, residual, energy (load, idle, tariff periods), admin | 6.8 |
| `rental.js`: rental classes, hourly and monthly modes | 6.9 |
| `subscription.js`: allowance, windows, weekly cap, sustained rate, overflow rules (single seat) | 6.10 |
| `api.js`: token pricing, caching, markup | 6.11 |
| `timeSeries.js`: monthly cumulative TCO 0 to 60, price changes, discount rate, GST, break-even, payback, ROI, cost per successful task | 6.13, 6.14 |
| `fitChecks.js`: context window check | 8 |
| `recommend.js`: filters, ranking, sensitivity rules, robustness sweep, recommendation text | 6.15 |
| `compute.js`: `compute(config, inputs) -> results` for the Single user tab | 9 |
| `params.js`: edit a parameter (status becomes user-supplied, original kept) | 10 |

Leave batching, fleet sizing, seats for many users and combinations for Phase 4 and 5, but design `compute` so they slot in without restructuring. For example, speed functions should already accept a concurrency argument that defaults to 1.

**Tests** in `tests/` using `node:test` and `node:assert`:
- A unit test for every engine function.
- Acceptance tests from spec section 13 that apply to the single-user path: **T1 to T12, T18, T19, T20.** Name them after the spec IDs. Tolerance ±10% unless the spec says otherwise (T1 is ±25%).
- A wiring test: for each banded parameter, swinging it from low to high changes only the outputs that depend on it (generalising T8).
- A no-magic-numbers check: a test that scans `src/engine/` (except `units.js`) for numeric literals other than 0, 1, 2 and 100 and fails if it finds any. Unit conversions come from `units.js`.

**Worked example output.** Add `scripts/example.js`, which runs `compute` for a Single user, Typical persona, Workday, Chat, Good quality, 3-year horizon on defaults, and prints a readable table: each option's upfront cost, monthly cost, TCO at years 1 to 5, capacity, coverage, per-user tok/s, break-even month against local, and the recommendation text. I'll use this to sanity-check the numbers before we build any UI.

## Rules for this session

- If a test fails because the spec's expected value looks wrong, **do not adjust defaults or formulas to force a pass.** Report the test, the computed value, the expected value, and your diagnosis.
- Record any deviation from the spec in `docs/decisions.md`, and any data pack problems in `docs/data-issues.md` (start from spec section 15).
- Commit in small steps using the message format in `CLAUDE.md`.

## End of session

Finish with:
1. What was built (files and spec sections).
2. Test results (pass/fail counts, and any failures explained).
3. The output of `scripts/example.js`.
4. Open questions for me.
5. The proposed scope for Session 2 (Phase 2: the Single user tab UI).
