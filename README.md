# AI Plan Picker

A phone-plan picker for AI delivery: **local hardware vs rented GPU vs
subscription vs API**, compared over a 1 to 5 year horizon with cumulative
TCO, break-even points, task-level feasibility and provenance-labelled
assumptions. One self-contained HTML file that opens offline by double-
clicking, plus a command line report.

## The question it answers

For my usage, quality target and data sensitivity, which delivery model (or
combination) gets my week of work done for the least money, and when do the
cost curves cross?

Plans meter different things: tokens (API), seats (subscriptions),
capacity-hours (rented GPUs) or ownership (buy hardware, carry the idle
time). The picker makes them comparable.

## Quick start

- Open `dist/comparator.html` in any browser. No install, no network needed.
- Or build it yourself: `node scripts/build-defaults.js && node build.js`
  (Node 20+, no npm dependencies).

## Command line

```
node bin/comparator.js                                    # one-line recommendation
node bin/comparator.js --persona power --usage_mode agentic --format table
node bin/comparator.js --config my-settings.json --format markdown
node bin/comparator.js --format json
node bin/comparator.js --sweep                            # CSV across personas and modes
```

`--config` takes the JSON exported from the Settings panel.

## How the model works

- Work is counted in **whole tasks** (quick questions, document summaries,
  RAG, agentic runs), checked task by task against every option: context,
  agent tools, model quality (success rates), window or request limits and
  session time.
- Options that cannot finish part of the week are **topped up** with the
  cheapest qualifying pay-as-you-go API, so every total is for the same
  completed week.
- Local hardware is found by a configuration search (platforms, GPU bands,
  RAM, placement classes) with a bandwidth speed model calibrated to
  published benchmarks. Speeds are shown as low/mid/high bands.
- Every number is an editable **parameter with provenance** (sourced,
  estimated, assumed, user-supplied) in the Settings panel.

## Updating data and assumptions

See `docs/data-updates.md`. In short: the data pack in `tco-data-pack/` plus
`assumptions.json` flow through `scripts/build-defaults.js` into
`src/defaults.json`; tests guard the results; `node build.js` rebundles the
HTML. Prices are dated snapshots; verify before relying on them.

## Documentation

- `ai-delivery-comparator-spec-v0.3.md` / `docs/spec.md`: functional
  specification (source of truth)
- `docs/decisions.md`: every modelling decision and its reason
- `docs/data-issues.md`: known problems in the data pack
- `docs/ROADMAP.md`: phases, change requests and the v2 backlog
- `docs/change-requests/`: change requests (the spec diff in each CR is the
  authority for what changes)

## Status

v1 scope: the Single user tab. Small business, Enterprise and Compare sizes
are deferred to v2 behind a feature flag. Licence: MIT.
