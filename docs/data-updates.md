# Updating data and assumptions

All defaults flow through one pipeline. Nothing in the engine holds a number
that could change; every value is a parameter record with status, source,
date and note.

## Where values live

| File | Holds | Provenance |
|---|---|---|
| `tco-data-pack/*.csv` | The client data pack: hardware snapshot, power estimates, tariffs, cloud prices, workload mixes, efficiency factors. **Read only.** | `status`, `source`, `source_date` columns |
| `tco-data-pack/assumptions.json` | Spec defaults not in the pack: parameters, platforms, GPU bands, tiers, presets, task attributes. | Each record carries status + note |
| `src/defaults.json` | Generated. Do not edit by hand. | |
| `src/engine/units.js` | Unit conversions only (the one allowed home for constants) | |

## Refreshing a price or measurement

1. Edit the CSV value (keep the `status`/`source`/`source_date` columns
   honest: a new date needs a new source note).
2. `node scripts/build-defaults.js`
3. `node --test tests/` (fix nothing silently: if a test disagrees with new
   data, that is a finding, see CLAUDE.md)
4. `node build.js`
5. Commit as `data: refresh <what>, <date>` with the source in the message.

## Changing an assumption

Edit `tco-data-pack/assumptions.json`, same pipeline, commit as
`data: <assumption> now <value> because <reason>`. Banded parameters must
keep their low/high bands; the tornado and robustness sweep use them.

## Runtime overrides (no rebuild)

The Settings panel edits any value (status becomes user-supplied, original
kept), applies presets, and exports the whole configuration as JSON. A JSON
config can be fed back via the Settings import or the CLI `--config` flag.
Edits persist in localStorage; export is the reliable path.

## If the pack looks wrong

Do not fix it silently: note it in `docs/data-issues.md` and follow the
spec's stated default (CLAUDE.md data rules).
