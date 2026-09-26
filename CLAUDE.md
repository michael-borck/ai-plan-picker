# CLAUDE.md

## Project

AI Delivery Comparator: an interactive page that compares local AI hardware, rented GPUs, subscriptions and APIs over a 1 to 5 year horizon, for a single user, a small business or an enterprise. It works like a phone-plan picker: given size, usage, quality target and data sensitivity, it recommends a delivery model (or combination) and shows the cumulative TCO curves and break-even points.

The full specification is `docs/spec.md` (currently v0.4). It is the source of truth. Read the relevant section before implementing anything, and cite section numbers in commit messages and comments where useful.

Client: Michael Borck (LocoLabo, Curtin University). Data: LocoLabo TCO Data Pack, 31 August 2026, in `data/`.

## Deliverable

One self-contained file, `dist/comparator.html`, that opens offline by double-clicking. Development happens in separate modules; `build.js` combines them.

## Structure

```
docs/spec.md               specification, current version (source of truth)
data/*.csv, data/README.md LocoLabo data pack (do not edit)
data/assumptions.json      spec defaults not in the pack (each with status "assumed")
scripts/build-defaults.js  CSV + assumptions.json -> src/defaults.json
src/engine/                pure calculation modules, no DOM
src/ui/                    tabs, inputs, settings panel, rendering
src/charts/                Chart.js wrappers
src/vendor/                inlined third-party code (Chart.js 4)
tests/                     node:test suites, one file per spec area
build.js                   bundles src/ into dist/comparator.html
```

## Commands

Node 20+. No npm dependencies for the engine or tests.

```
node scripts/build-defaults.js   # regenerate src/defaults.json from data/
node --test tests/               # run all tests
node build.js                    # produce dist/comparator.html
```

Run the tests after every engine change. Do not finish a task with failing tests.

## Architecture rules

- **One engine, pure functions.** `compute(config, inputs) -> results` with no DOM, no globals, no randomness. Every tab calls the same engine. A tab is only `{defaults, visible_inputs, chart_order}`.
- **No numbers in engine code.** Every value that could change (prices, watts, efficiencies, multipliers, thresholds) comes from `config`. Constants allowed in code: unit conversions only (seconds per hour, hours per day, days per week, weeks and months per year, bits per byte, 1000, 1e6), plus 0, 1, 2 and 100 for arithmetic and percentages. Keep the allowed list in one place, `src/engine/units.js`.
- **Parameter records.** Every config value has: `id, label, value, low, high, unit, status, source, source_date, note`. Status is one of `sourced | estimated | assumed | user-supplied`.
- **Provenance is never laundered.** When the user edits a sourced, estimated or assumed value, its status becomes `user-supplied` and the original is kept. Never copy an estimate into a field labelled sourced.
- **Units.** Store watts, GB, tokens, hours and AUD. Convert only at display. FX (USD to AUD) is a parameter, default 1.54, never a constant.
- **Tokens vs Standard Queries.** Keep them distinct in variable names (`tokens_per_day`, `sq_per_day`) and in every label.
- **Bands.** Any parameter with low/high values must flow through so results can be shown as low / mid / high and used in the sensitivity tornado.
- **Per-tab state.** Each tab owns its own `inputs`. Switching tabs never overwrites another tab's inputs.
- **Browser storage.** `localStorage` is allowed (the file runs standalone), but everything must also work with it unavailable. JSON export/import is the reliable path.

## Data rules

- `data/` files are read-only inputs. If the pack looks wrong, do not fix it silently: note it in `docs/data-issues.md` and follow the spec's stated default. Spec section 15 lists known issues.
- Defaults not in the pack go in `data/assumptions.json` with `status: "assumed"` and a note explaining the reasoning.
- The pack's power method: inference draw = nameplate × 0.60 (band 0.45 to 0.75). Idle draw and duty cycle matter more than load. Keep these as parameters.

## Testing

- The acceptance tests in spec section 13 (T1 to T25) are the minimum. Implement each as a named test (`T6: single user typical API Best`).
- Tolerances: ±10% unless the spec says otherwise (T1 is ±25%).
- **Never change a default or a formula just to make a test pass.** If a test and the spec disagree, stop and report it.
- Add a unit test for each engine function as you write it.

## UI text conventions

- Australian English spelling (organisation, utilisation, colour).
- **No em dashes in any UI text, labels, tooltips, disclaimers or generated recommendation text.** Use commas, colons, or separate sentences.
- Plain, short sentences. Every estimate says it is an estimate. Disclaimer text is in spec section 12; use it as written.
- Recommendation text follows the template in spec section 6.15.
- Terminology: "cumulative TCO", "break-even point", "payback period", "payback view". Not "ROI curve" or "crossover". ROI is a single percentage in the table.

## Working style

- Changes arrive as change requests in `docs/change-requests/`. The spec diff named in the CR is the authority for what changes. Do not change anything a CR does not mention.
- Plan before coding a new phase: list the files you will create, the spec sections they implement, and any spec ambiguities. Ask about ambiguities rather than guessing when the answer changes results.
- Small commits, one spec area at a time, message format: `engine: subscription windows (spec 6.10)`.
- If you need to deviate from the spec, write the deviation and the reason in `docs/decisions.md` and flag it in your summary.
- End each session with: what was built, test results, open questions, and the next step.

## Build phases

1. Engine and tests (single-user path), defaults pipeline.
2. Single user tab: Pick a plan, cumulative TCO chart, hardware card, comparison table, Hardware explorer.
3. Settings panel with provenance, presets, JSON import/export.
4. Small business and Enterprise tabs: concurrency, batching, fleet sizing, seats, band shift at 20 users.
5. Combinations and routing matrix.
6. Compare sizes tab: winner map, break-even by size (Web Worker from inline code).
7. Teaching mode, print stylesheet, mobile layout, shared links, final single-file build.
