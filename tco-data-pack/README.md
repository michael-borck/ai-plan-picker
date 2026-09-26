# LocoLabo TCO Data Pack — for the Local AI vs Cloud AI capstone team

**From:** Michael Borck (LocoLabo, client) **Date:** 31 August 2026
**Replaces the pending items:** hardware inventory with costs, running costs,
and interim power figures. The items stand in for hands-on lab access until the
machines are available, and every one of them is structured so you can swap in
measured numbers later without rebuilding anything.

---

## The one rule that applies to everything in this pack

Your client requirements say every figure must be labelled **sourced** (link +
date) or **assumed** (reasoning). This pack obeys that convention in every file
via `status`, `source` and `source_date` columns. Carry those labels into your
Sources sheet — do not launder an estimate into a sourced figure by copying it
into a clean spreadsheet.

Three provenance levels appear in this pack:

| Label | Meaning | Your obligation |
|---|---|---|
| `sourced` | Published by the lab or a public page. Currently only the hardware snapshot. | Cite it. Optionally re-verify. |
| `estimated` | Client-supplied estimate built from published figures plus a documented method. Close to real, not measured. | Treat as a parameter. Verify where marked. |
| `assumed` | A modelling assumption (workload mixes, efficiency factors). | These are yours to challenge and vary. That is the point. |

**Nothing in this pack is a measurement.** The lab's power instrumentation is
underway; when results land they will replace the power estimates directly —
same columns, same units, so keep your formulas pointing at the parameter cells,
not the numbers.

---

## Files

| File | What it holds | Provenance |
|---|---|---|
| `hardware_picker_snapshot.csv` | 24 GPUs: VRAM, bandwidth, nameplate watts, cost brackets USD + AUD at 1.54, availability, tokens/sec benchmarks, MMLU quality | **Sourced** — picker.locobench.org, compiled 18 April 2026 |
| `power_estimates.csv` | Per card: estimated inference draw (45% / 60% / 75% of nameplate), estimated idle draw, watt-hours per 1,000 tokens, indicative energy cost per million tokens | **Estimated** — method in the file |
| `lab_fleet_machines.csv` | The lab's actual 6 machines, 28 cards, mapped to your three scenarios (single user / department / institution), with estimated base system draw | Cards sourced; base watts estimated |
| `hidra_scaling_curve.csv` | Estimated machine watts and Wh/1k tokens at 1–4 cards — the consolidation curve showing chassis overhead amortising | **Estimated** |
| `electricity_tariffs_wa.csv` | WA (SWIS) tariff classes: residential, small business flat and time-of-use, contestable >50 MWh with demand charges. Ranges, not points | **Estimated ranges** — verify against Synergy's current published schedule |
| `cloud_api_pricing.csv` | Per-million-token prices, 4 providers × frontier/small/premium tiers, USD + AUD | **Estimated** — snapshot 31 Aug 2026; verify against provider pricing pages before final report |
| `cloud_subscription_pricing.csv` | Per-seat monthly prices, 3 providers, individual → enterprise tiers | **Estimated** — same caveat |
| `cloud_gpu_rental_pricing.csv` | Rent-vs-own third leg: hourly GPU rental, reserved monthly GPU, GPU VPS | **Estimated** |
| `delivery_models.csv` | The full spectrum: own (new/secondhand), colocate, rent hourly/monthly, self-host, API direct/via intermediary, subscription business/enterprise — who owns hardware, who operates, where data lives, cost shape, governance | **Framing** — rows reference the pricing files |
| `workload_profiles.csv` | Five task types with token counts; three personas (power/typical/light) with queries/day and tokens/day | **Assumed** — yours to vary |
| `token_efficiency_factors.csv` | How many tokens each model class burns to do the same job, including the reasoning-token effect | **Assumed** — challenge these |

Open any of them in Excel or LibreOffice Calc directly.

---

## The method behind the power estimates (so you can defend the numbers)

**Inference draw = nameplate TDP × 0.60** (band 0.45–0.75). Text generation is
limited by memory bandwidth, not computation, so real draw sits well below TDP.
The published picker watts are ceilings. This is the single most common mistake
in local-AI cost models — using 350 W where a card actually draws ~210 W while
generating — and it errs against local AI, which is the safe direction to err.

**Watt-hours per 1,000 tokens = mid watts ÷ (3.6 × tokens-per-second).** The
tokens/sec figures are the picker's throughput benchmarks. This is the number
that puts the local side on the same denominator cloud pricing uses.

**Idle draw matters more than load.** Run the arithmetic early: a machine idling
at ~135 W for a year consumes ~1,180 kWh regardless of how many tokens it served.
Whether electricity decides your crossover depends almost entirely on **duty
cycle** — the share of hours the hardware is powered but idle. That parameter
belongs in your spreadsheet, not in this data, because it is an assumption about
the organisation being modelled, not a property of the hardware. Give it its own
labelled cell and put it high on your sensitivity list.

**Base system draw** (CPU, RAM, drives, PSU losses) is per machine in
`lab_fleet_machines.csv` — card-level figures exclude it. Total machine draw =
base + card(s).

---

## What the finished model must be able to tell an organisation

The client's framing: AI delivery today is like mobile phone plans in their
early days — a confusing bundle of ways to pay for the same thing. The model's
job is to be the plan-picker: given an organisation's size, usage profile and
data sensitivity, say **which delivery model to choose and why**. Two
implications.

**Delivery models differ by what they meter.** Mobile plans meter minutes or
data; AI packages meter **tokens** (API), **seats** (subscriptions),
**capacity-hours** (rented GPU), or **ownership** (buy hardware, eat the idle
time). `delivery_models.csv` lays out the full spectrum from own-on-premises
through rented racks to enterprise subscriptions, with cost shape and data
location for each. Your comparison should treat rent as its own model, not a
hybrid of local and cloud — its cost shape is closer to local (cheap tokens, no
capex) but its data governance is cloud (the data leaves the premises). A
three-way crossover is a stronger finding than a two-way one, and the privacy
assessment can veto a cheapest option regardless of price — that is where the
non-financial-constraints deliverable plugs in.

**Recommendations must read like plan advice.** "Local overtakes cloud at N
users" is an intermediate result. The finished report should be able to tell a
reader of any size: *an organisation with your usage profile should choose X,
because Y, and here is how confident we are that Z won't change that.* The
scenarios, crossovers and sensitivity grids you are building anyway are the
inputs; the recommendation is the output.

---

## How this pack maps to your brief


- **Three scenarios** → `lab_fleet_machines.csv` maps a real machine to each of
  your scenarios: Hormiga (single user), Búho (department ~20), Hidra
  (institution ~500, scale 1→4 cards).
- **Rent-vs-own lifecycle** → `cloud_gpu_rental_pricing.csv` lets you compare
  owning a 4090-class card outright against renting the identical card by the
  hour or month. This is the purest form of the rent-vs-own question.
- **Token efficiency** (raised 25 Aug) → `token_efficiency_factors.csv`. The
  correction factor for "local burns more tokens for the same answer" is not
  published anywhere; these are documented assumptions for you to test.
- **Multiple cloud providers** → four in the API file, three in subscriptions,
  plus marketplace/datacentre rental.
- **Hardware price direction** → the 2×2 (hardware price × cloud price
  direction) from your client requirements is directly buildable from the
  `cost_usd_low/mid/high` columns. The pickers' brackets date from 18 April
  2026 — re-pricing a handful of these cards from current listings is the
  cheap original-data exercise described in your requirements document.

## What you should verify yourselves (each is small)

1. **Tariffs** against Synergy's current published business schedule — confirm
   the ranges, cite with the date you checked.
2. **Cloud prices** against each provider's pricing page — prices move monthly.
   Capture date + URL per figure from day one.
3. **Hardware prices** — the re-pricing exercise above.
4. **Workload mixes** — sanity-check the persona token volumes against any real
   usage data you can find (provider public usage studies are fine, labelled).

## A note on what is deliberately not here

No measured wall-plug power, no energy-per-token from the lab's own machines,
and no hands-on model access yet. Those are deferred, not cancelled: the
machines are being instrumented and the measured JSON will drop into the same
units used here (idle watts per machine, Wh per 1,000 tokens, the Hidra scaling
curve). Build with these estimates as parameters and the swap is a cell edit,
not a rebuild. If the crossover barely moves across the 0.45–0.75 power band,
you will have *proven* that measurement precision was never a project blocker —
that is a finding, and the client would genuinely like to see it either way.

Questions on any of this: michael.borck@curtin.edu.au, or bring it to the
fortnightly.
