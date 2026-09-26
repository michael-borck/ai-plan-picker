# Data pack issues

Start from spec section 15. New observations are added below as found.

## From spec section 15 (verbatim summary)

1. Persona totals vs task mix: 120k/30k/6k tokens/day stated, about
   208k/56k/12k implied by mix × queries. The comparator uses the mix ×
   queries figures (spec 2.2 table) as source of truth.
2. Open-ended top price bracket: 4090/5080/5090 share AUD 1,434 mid as a
   floor. The comparator does not price cards from brackets; it uses band
   AUD/GB defaults from spec 11.1 (status assumed).
3. Tesla M40 benchmark implies η about 0.20, far below the 0.43 to 0.85
   elsewhere. The M40 is not referenced by any band size point, so the
   anomaly does not flow into results.
4. Premium API row (USD 15/75): kept, status estimated, flagged "verify"
   (spec 11.8).
5. The 20x subscription tier (USD 200) is missing from the pack; added as
   assumed AUD 308 (spec 11.7).
6. Hidra curve assumes independent parallel streams; used only for the
   batching/fleet path (6.5), not single-stream large models.
7. Energy per token in the pack uses 8B throughput; the comparator recomputes
   energy from its own speed model (6.8).
8. "Local models give the same answer without hidden tokens" is not true for
   local reasoning models; thinking effort applies to both sides (2.6).
9. Default context raised to 16k so the Analysis/RAG task (10k input) fits
   (spec 0 v0.2 item 9). T19 still exercises the 8k failure path.

## New observations

N1. `electricity_tariffs_wa.csv`: it is unknown whether the published
    c/kWh ranges include GST. Residential figures behave as if GST-inclusive
    (29 to 35 c/kWh matches Synergy A1 incl-GST); business ranges are less
    clear. The comparator treats tariff rates as paid (no extra GST applied)
    and flags this for verification.

N2. `hardware_picker_snapshot.csv`: RTX 4090 cost_usd_high and
    cost_aud_high are empty (bracket ceiling not published). Not used by the
    engine (bands, not cards, are priced) but noted for the calibration table.

N3. `cloud_subscription_pricing.csv` note row ("Subscription vs API
    crossover") is a worked example, not a priced option; the CSV parser must
    skip footer note rows.

N4. `workload_profiles.csv` holds a second table (personas) below the task
    table plus an adoption note row; same parser requirement as N3.

N5. `cloud_api_pricing.csv` has a trailing "AUD conversion note" row with no
    numeric fields; parser must skip it rather than emit a zero-price row.

N6. CSVs use Windows CRLF line endings and quote-embedded commas; the parser
    handles CRLF, BOM and quoted fields.

N7. `lab_fleet_machines.csv` "Buho" is written without accent in the CSV but
    "Búho" in the README and spec; cosmetic only.
