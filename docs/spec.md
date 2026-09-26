# AI Delivery Comparator: Local vs Rented GPU vs Subscription vs API

**Functional specification, v0.4 (draft, supersedes v0.3)**
**Owner:** Michael Borck (LocoLabo)
**Date:** 26 September 2026
**Data basis:** LocoLabo TCO Data Pack (31 August 2026), plus assumptions marked below

---

## 0. What changed

### v0.3 to v0.4 (change request CR-001, task layer)

1. **The task is the unit of work** (new section 2.8). Every task type is checked against every option: context, agent tools, quality (success rate and retries), window or daily-request fit, and session time. Result: a status per task and option (Yes / Slow or limited / No, with a reason).
2. **Coverage is the share of your work an option finishes itself,** by task size, filled smallest tasks first. It replaces token-per-day coverage for deciding eligibility.
3. **Pay-as-you-go top-up** finishes whatever an option cannot, so every TCO is for the same completed week (6.11a). On by default.
4. **Success rates replace the retry part of the efficiency factor.** The pack's verbosity factor stays (2.5). The retry factor is no longer used, to avoid counting the same weakness twice.
5. **The single "biggest task" session veto is removed.** Session time now marks a task as Slow; it does not exclude the option.
6. **Cached input** is excluded from local reprocessing and counted at a reduced weight against subscription allowances.
7. **Request-limited plans** (free models via a broker) added, with a reliability setting and a "may train on your data" flag (6.10a, 11.7).
8. **Scope:** Single user only. Small business, Enterprise and Compare sizes are deferred and hidden (1.3). Their sections stay in this document for later.
9. New acceptance tests N1 to N11 (13.1).

### v0.2 to v0.3

1. **Page structure:** three size tabs (Single user, Small business, Enterprise) plus a Compare sizes tab, replacing the size dropdown (section 1.2).
2. **Size classes merged to three:** Small team and SME become one Small business tab (2 to 200 users), with defaults that shift at 20 users (section 3.1).
3. **Hardware explorer** lives inside the Single user tab; the business tabs get a fleet panel instead (section 4).
4. **Settings** is a panel reachable from every tab, not a view; Teaching mode, GST display and horizon are global (section 1.2).
5. **Per-tab state:** each tab keeps its own inputs, and all tabs share one calculation engine (section 9).
6. **Restored section 6.4a** (selecting the local configuration, budget-only ladders, no-fit message), which was dropped in error from v0.2.

### v0.1 to v0.2

1. **Organisation size** is now a core input, from 1 person to 5,000 staff, with fleet sizing, concurrency, seat licensing and admin cost that scale with it (section 3).
2. **Combinations** (for example subscription plus local box, or local plus API overflow) are in v1, using a task-routing matrix (section 6.12).
3. **Capability matching:** each option is compared at matched quality by default, with cloud Best available as a reference line (section 2.4).
4. **Cumulative TCO and payback views:** cumulative TCO curves and payback curves over the estimated life, break-even by organisation size, and a "winner map" (section 7).
5. **Two entry points:** *Pick a plan* (demand first) and *Explore hardware* (budget first), plus an Expert configuration layer and a Teaching mode (section 1.2).
6. **New demand inputs:** usage mode (chat / documents / agentic), thinking effort applied to both local and cloud, usage-intensity presets, and demand growth.
7. **New metrics:** time spent waiting, cost per successful task, utilisation of owned hardware, context-window pass/fail, and a features checklist.
8. **Time effects:** annual price change per option, discount rate, GST convention.
9. **Default context raised from 8k to 16k.** The pack's RAG task uses 10k input tokens, which would not fit in 8k.

---

## 1. Purpose and audiences

### 1.1 Purpose

A single interactive HTML page that works like a phone-plan picker for AI. Plans meter different things: **tokens** (API), **seats** (subscriptions), **capacity-hours** (rented GPU) or **ownership** (buy hardware and carry the idle time). The page tells a person or organisation which delivery model, or combination, to choose, why, and how confident the answer is.

It answers:

1. For my organisation size, usage and data sensitivity, which option or combination is cheapest at the quality I need, and when do the cost curves cross?
2. What local hardware would that take, and how fast would it be?
3. Given only a budget, what is the largest model I can run at an acceptable speed?
4. When does a subscription's reset window make a slower but always-available local box more useful (and vice versa)?

Everything is generic. The page reasons about model *size*, hardware *tiers* and cloud model *classes*, not named products. Every number is an editable parameter with a provenance label.

### 1.2 Page structure and audiences

One page, four tabs, one calculation engine. The tabs differ in which inputs they show and which defaults they load, never in how results are calculated.

```
[ Single user ] [ Small business ] [ Enterprise ] [ Compare sizes ]      Horizon ▾  GST ▾  Teaching ☐  ⚙ Settings
```

| Tab | Users | Who it is for | Leads with |
|---|---|---|---|
| **Single user** (default) | 1 | Individuals, students, technical buyers | Pick a plan, with a Hardware explorer sub-view (budget and model size, or budget only) |
| **Small business** | 2 to 200 (default 20) | Teams, departments, SMEs | Staff and adoption, shared hardware, combinations |
| **Enterprise** | 200 to 5,000 (default 500) | Institutions, large organisations | Adoption scenarios, seat licensing, fleet, governance |
| **Compare sizes** | 1 to 5,000 sweep | Everyone, and the report | Winner map and break-even by size |

**Global controls** (top bar, apply to every tab): horizon (1 to 5 years), GST display (incl. / ex.), Teaching mode, and the Settings panel.

**Settings panel** (gear icon, slide-over from any tab): every parameter, presets, import/export (section 10). Parameters are shared by all tabs; each tab only changes its *defaults* for size-dependent settings.

**Teaching mode** (toggle): every result shows its formula with values substituted, and each assumption links to its source row. Aimed at students, available everywhere.

**Compare sizes** takes its usage mode, quality target, sensitivity and thinking level from a "based on" selector (default: the last size tab used), then sweeps organisation size using each size's defaults for everything else. The sweep assumptions are listed above the charts so the reader knows what was held constant.

### 1.3 Scope for v1

**v0.4 scope change:** v1 ships the **Single user** tab only. The Small business, Enterprise and Compare sizes tabs are hidden behind a feature flag (`features.org_tabs = false`) and their sections (3, 4.2a, 6.5, 6.6, 6.12, parts of 7) are deferred to v2. Code for them may stay but must not be reachable in the UI.

Originally in scope: 1 to 5,000 users, AUD, generic GPU tiers (consumer, legacy server, datacentre), generic cloud classes, 1 to 5 year horizon (charts to 60 months), electricity including demand charges, admin labour, combinations, data-sensitivity rules.

Out of scope for v1: fine-tuning and training, named-model benchmarks, colocation, hyperscaler IaaS (section 16).

---

## 2. The comparison principle

### 2.1 The headline metric

**The cost of getting your whole week of work done, at the quality you need.** Work is counted in whole tasks (2.8), not tokens. An option that cannot finish some tasks is either topped up with pay-as-you-go (default) so every option delivers the same week, or shown with the share of work it leaves undone. Token rate is an input, not the answer. Every option is compared on:

| Dimension | Unit |
|---|---|
| Cost over the horizon | AUD, cumulative by month (nominal, or discounted) |
| Capacity | Share of your week's work finished on its own (2.8), plus SQ and tokens per day |
| Speed | Output tok/s per user (burst), and time to first token |
| Waiting time | Hours per user per year spent waiting for answers |
| Capability | Quality level, success rate per task type (2.8) |
| Availability | Sustained vs burst-then-lockout; peak-hour coverage |
| Fit checks | Context window pass/fail, features checklist |
| Data location | Premises / provider rack / provider multi-tenant |

### 2.2 Standard Query (SQ)

Subscriptions and APIs meter input plus output tokens. Local hardware processes input (prefill, fast) and output (decode, slow) at very different rates. The common unit is a Standard Query, defined by a task mix: `SQ_in` and `SQ_out` are the weighted average input and output tokens per query.

From the pack's chat mix:

| Persona | SQ_in | SQ_out | Tokens per SQ | Queries/day | Tokens/day implied |
|---|---|---|---|---|---|
| Power | 4,175 | 1,015 | 5,190 | 40 | 207,600 |
| Typical | 2,875 | 855 | 3,730 | 15 | 55,950 |
| Light | 1,750 | 715 | 2,465 | 5 | 12,325 |

(These implied totals are about double the pack's `est_tokens_per_day` column; see section 15, item 1.)

### 2.3 Usage hours are not generation hours

A person using AI for 8 hours does not keep a GPU busy for 8 hours. Generation time is derived:

`busy_seconds_per_SQ = SQ_in / prefill_tps + SQ_out × thinking × efficiency / decode_tps`

The user sets the **interactive span** (hours the service must be available) and **unattended hours** (agents, overnight batch). Nobody chats for 20 hours, so a 20-hour case is modelled as automation, not heavy chatting.

### 2.4 Capability matching

Comparing a local 14B against cloud Best flatters the cloud on quality and local on price. The page therefore compares at **matched capability** by default and shows cloud Best as a dashed reference line.

The user picks a **quality target**. Each target maps to a local size class and a cloud class (editable, assumed):

| Quality target | Local model class | Cloud class | Typical local hardware |
|---|---|---|---|
| Basic | 7 to 14B dense, or small MoE | Cheap | 8 to 16 GB GPU |
| Good | 24 to 32B dense, or 30B MoE | Cheap | 24 GB GPU, or 12 GB + RAM (MoE) |
| High | 70B dense, or 100 to 120B MoE | Previous | 2 × 24 GB, or 48 GB+, or GPU + large RAM (MoE) |
| Frontier | 235B+ MoE | Best | Datacentre GPUs or large unified memory; organisations only |

The Frontier row assumes large open models land near the previous cloud generation. The UI says so.

In the Hardware explorer, the matched cloud class comes from the effective size of the chosen model (section 6.7).

### 2.5 Verbosity factor (changed in v0.4)

Smaller models tend to write longer answers for the same job. The pack's `equivalent_output_token_factor` is kept as a **verbosity factor** that multiplies output tokens for local size classes (cloud Best 1.00; cloud classes have their own verbosity multiplier, default 1.0).

The pack's `retry_or_rerun_factor` is **no longer used in any calculation.** Retries now come from the success rates in 2.8, which depend on the task as well as the model. Using both would count the same weakness twice.

### 2.6 Thinking effort

Thinking applies to both local and cloud, because the same job needs the same reasoning. It hurts them differently: in the cloud it costs money and allowance; locally it costs time. Levels multiply output tokens: Off 1×, Low 1.5×, Medium 3×, High 6× (assumed). Per-option override allowed (for example, a local non-reasoning model).

### 2.7 Waiting time

`wait_hours/user/year = SQ/day × (TTFT + SQ_out × thinking / per_user_tps) × days/year / 3600`

Always shown. Optionally costed using a **value of time per hour** (default off, because it can dominate every other cost).

### 2.8 Task layer (new in v0.4)

Work arrives as whole tasks. A plan with plenty of tokens per week can still fail a task that is bigger than one reset window, needs a longer context, needs agent tools, or needs a stronger model. The task layer checks every **task type** against every **option**.

**Task types.** The pack's five task types plus Agentic and an optional Hard problem. Each has (defaults in 11.11, all assumed except the pack's token counts):

| Field | Meaning |
|---|---|
| steps | Requests per task (1 for chat-style tasks, 20 for an agentic task) |
| input_per_step, output_per_step | Tokens per request (pack values for the five pack tasks) |
| cacheable_share | Share of each step's input that repeats the previous step (reused context) |
| context_need_k | Context one step needs. Default: computed as (input_per_step + output_per_step × thinking) / 1000, rounded up; can be overridden |
| quality_needed | Basic / Good / High / Frontier |
| needs_agent_tools | Yes for Agentic, otherwise no |

**Counts.** Tasks per day per type come from the existing demand model (persona, usage preset, usage mode, share of each task in the mix, agent tasks per day), using the existing day convention (decisions D2). An optional **"Use my own week"** mode lets the user type counts per task type per week instead.

**Option attributes used by the task layer:** quality level, context window, agent tools (yes/no), reliability (share of requests that succeed, default 1.0), speed (decode, prefill, time to first token), and for metered plans the window allowance, weekly cap, or daily request limit. Quality levels: local from its capability band; cloud Cheap = Good, Previous = High, Best and Premium = Frontier, Budget offshore = High; Free chat tier and broker free models High (assumed).

**Gates, in order, for task t on option o:**

1. **Context:** `context_need_k(t) ≤ context_k(o)`, else **No** ("Needs 45k context, has 32k").
2. **Agent tools:** if `needs_agent_tools(t)` and not `agent_tools(o)`, **No** ("No agent or coding tools").
3. **Quality:** `gap = quality_needed(t) − quality(o)`; success rate p = 0.95 (gap ≤ 0), 0.60 (gap 1), 0.25 (gap 2), 0.05 (gap ≥ 3). If `p < p_min` (0.30), **No** ("Model too weak for this task").
4. **Sensitivity:** existing option-level rules (6.15). A vetoed option shows **No** for every task, with the reason.
5. **Single-task fit** (metered plans):
   - Window plans: if one task's allowance use exceeds one window, it spans `ceil(units / allowance)` windows and waits `(spans − 1) × window_h`. If it exceeds the weekly cap, **No** ("One task is bigger than the weekly allowance").
   - Request-limited plans: if one task's requests exceed the daily limit, it spans `ceil(requests / requests_per_day)` days. Requests per minute add a minimum time of `requests / requests_per_min` minutes.
6. **Session time:** wall time above `tasks.session_tolerance_min` (interactive tasks) or `tasks.agent_tolerance_min` (agent tasks, default 120, ignored when unattended hours > 0) makes the task **Slow**, not No.

A task that passes the gates is **Yes**, or **Slow or limited** if it spans windows or days, has p < 0.95, exceeds the session tolerance, or is cut back by weekly capacity. Every Slow and No carries a plain-language reason.

**Per-task quantities (attempts a = 1 / (p × reliability)):**

```
new_in   = input_per_step × (1 − cacheable_share)
cached   = input_per_step × cacheable_share
out      = output_per_step × thinking × verbosity
requests = a × steps
units    = a × steps × (new_in + cached × sub_cache_weight + out)       # subscription allowance use
api_aud  = a × steps × ((new_in + cached × (1 − cache_discount)) × p_in + out × p_out) / 1e6
t_step   = ttft + new_in / prefill_tps + out / decode_tps                # local and rental: ttft = local_ttft
wall     = a × steps × t_step  (+ window or day waits from gate 5)
```

Local and rented machines reprocess only `new_in`, because agent frameworks reuse the cached context. `sub_cache_weight` default 0.1 (assumed).

**Weekly capacity and fill order.** Each option has a weekly limit on its own: hours available (local, rental: interactive span plus unattended hours), allowance (window plans: usable windows × allowance, capped by the weekly cap), requests (request-limited plans: requests per day × days of use), or none (API). Feasible tasks are filled **smallest first** (by units per task), until the limit is reached. The last task type may be partly done.

**Coverage.** `own_share = Σ done_t × size_t / Σ count_t × size_t`, where `size_t = steps × (input_per_step + output_per_step)`. Shown as "On its own" in the grid and table.

**Leftover** tasks (No, or not reached in the fill) go to top-up (6.11a) when it is on; otherwise they are reported as undone.



### 3.1 Size classes and defaults

Each tab loads its defaults; the user can override any of them. All values are assumed.

| Tab (band) | Staff (default) | Adoption | Persona mix power / typical / light | Tariff default | Hardware default | Seat tier default | Admin default | Facility PUE |
|---|---|---|---|---|---|---|---|---|
| Single user | 1 | 100% | chosen persona | Residential | Secondhand OK | Consumer (Free/Base/Pro/Max) | DIY, AUD 0 | 1.0 |
| Small business (2 to 20) | 20 | 70% | 20 / 50 / 30 | Small business | Secondhand OK, desktop or workstation | Business seat | 2 h/month at AUD 120 | 1.0 |
| Small business (21 to 200) | n/a | 50% | 10 / 50 / 40 | Small business TOU | New, warranted, server platforms available | Business seat | 8 h/month + 4 h/box/month at AUD 100 | 1.2 |
| Enterprise | 500 (200 to 5,000) | 50% (scenarios 20 / 50 / 80) | 10 / 40 / 50 | Contestable + demand charge | New, datacentre class | Enterprise seat | 0.25 FTE + 4 h/server/month (FTE AUD 140,000) | 1.4 |

**Band shift inside Small business.** When the staff count crosses 20, defaults switch from the 2 to 20 row to the 21 to 200 row, *except for any value the user has edited*, which stays as set. A small note appears ("Defaults updated for 21+ users") with an undo link.

**Tab limits.** Small business caps staff at 200 and Enterprise starts at 200. Entering a number outside the range shows "Over 200 staff? Open in Enterprise" (or the reverse), which copies the shared inputs into the other tab.

The pack's scenarios map directly: Hormiga (Single user), Búho (Small business, about 20), Hidra (Enterprise, about 500).

### 3.2 Peak demand and concurrency

```
active_users   = staff × adoption
daily_SQ       = Σ personas (active_users × share × queries/day)
peak_hour_SQ   = daily_SQ × peak_hour_share                  # default 0.20 (1.6× a flat 8 h day)
busy_s_per_SQ  = from 2.3, at batched throughput (6.5)
cards_needed   = ceil(peak_hour_SQ × busy_s_per_SQ / 3600 × headroom)   # headroom 1.3
```

Unattended work is scheduled outside peak hours by default and only adds cards if it cannot finish in the unattended window.

### 3.3 Seat licensing

Subscriptions can be licensed for **all staff** or **active users only** (toggle, default all staff for Enterprise, active only for Small business). This is where subscriptions become "a tax on idle staff" at low adoption, as the pack notes.

### 3.4 What scales with size

| Cost element | Single user | Small business | Enterprise |
|---|---|---|---|
| Local hardware | One box (staircase of 1) | Shared box(es), batching engine | Server fleet, staircase |
| Rental | Hourly or monthly 24 GB | Monthly reserved | Reserved datacentre GPUs |
| Subscriptions | 1 consumer seat | Business seats | Enterprise seats, negotiated band |
| API | Direct | Direct or via intermediary | Intermediary / committed spend |
| Admin | DIY | Paid hours | FTE share |
| Electricity | Flat residential | Business, TOU | Contestable, demand charge, PUE |

---

## 4. Inputs

### 4.1 Inputs by tab

✓ shown, · hidden (the tab's default is used), **bold** = shown prominently at the top of the tab.

| Input | Type | Single user | Small business | Enterprise | Notes |
|---|---|---|---|---|---|
| Staff | Number | · (1) | **✓ 2 to 200, default 20** | **✓ 200 to 5,000, default 500** | Drives band shift (3.1) |
| Adoption rate | % | · (100%) | ✓ | **✓ as scenario buttons 20 / 50 / 80%** plus custom | |
| Persona | One of Light / Typical / Power / Custom | **✓** | · | · | |
| Persona mix | Three sliders summing to 100% | · | ✓ | ✓ | |
| Usage intensity | Preset (4.3) | **✓** | ✓ | ✓ | |
| Usage mode | Chat / Documents / Agentic | ✓ | ✓ | ✓ | Sets the task mix (4.4) |
| Parallel agents | Number | ✓ (default 1) | · | · | Concurrency for one person |
| Thinking effort | Off / Low / Medium / High | ✓ | ✓ | ✓ | Applies to all options (2.6) |
| Quality target | Basic / Good / High / Frontier | **✓** | **✓** | **✓** | Frontier hidden in Single user unless enabled in Settings |
| Sensitive share of work | % | · (0%) | ✓ | **✓** | Share of tasks that must stay on premises |
| Data sensitivity rule | Public / Internal / Sensitive | ✓ | ✓ | ✓ | For the non-sensitive share (6.15) |
| Seat licensing | All staff / Active users | · | ✓ | **✓** | 3.3 |
| Hardware budget cap | AUD or "auto" | ✓ (in explorer) | ✓ | ✓ | Auto = cheapest build that meets demand |
| Must be new and warranted | Toggle | ✓ | ✓ | ✓ (on) | 6.2 |
| Combination builder | Presets + routing matrix | ✓ (collapsed) | **✓** | **✓** | 6.12 |
| Tariff preset | Select | ✓ (Residential) | ✓ | ✓ (Contestable) | 11.3 |
| Value of time | AUD/h or off | ✓ | ✓ | ✓ | Off by default everywhere |

### 4.2 Hardware explorer (Single user tab)

A sub-view toggle at the top of the Single user tab: **Pick a plan** | **Hardware explorer**.

Mode (Fixed model / Budget only), budget (AUD 2,000), total parameters (14B), Dense/MoE, active parameters (MoE), quantisation (Q4_K_M 4.85 bits/weight; Q3 3.9, Q5 5.7, Q6 6.6, Q8 8.5, FP16 16), context (16k), minimum speed (10 tok/s), hardware market (Secondhand / New / Either), objective (Fastest within budget / Cheapest that meets minimum / Best value). The usage inputs from Pick a plan still drive the cost comparison below the hardware card.

### 4.2a Fleet panel (Small business and Enterprise tabs)

Shows the fleet the engine chose (platform, GPU band, cards per box, number of boxes, per-user speed at peak) and lets the user override the platform, GPU band, model size, cards per box, or budget cap. The capacity staircase chart sits beside it.

### 4.3 Usage-intensity presets

| Preset | Interactive span h/day | Unattended h/day | Days/week | Queries/day multiplier |
|---|---|---|---|---|
| Occasional | 1 | 0 | 5 | 0.3 |
| Part-day | 3 | 0 | 5 | 0.6 |
| Workday (default) | 8 | 0 | 5 | 1.0 |
| Extended | 12 | 0 | 6 | 1.3 |
| Workday + overnight agents | 8 | 10 | 5 | 1.0 + agent load |
| Always-on automation | 2 | 20 | 7 | agent load only |

Agent load is entered as agent tasks per day (default 20 when enabled) using the Agentic task profile.

### 4.4 Usage modes (task mixes)

(v0.4: the modes below set the counts per task type for the task layer, 2.8. "Use my own week" replaces them with typed counts.)

| Mode | Basis | Status |
|---|---|---|
| Chat | Pack task mix, persona shares | A (pack) |
| Documents | Pack mix shifted: 50% Document summary, 30% Analysis/RAG, 20% Writing | A |
| Agentic | Per task: 20 steps × 15,000 context input (70% cacheable) + 800 output per step → 300,000 in, 16,000 out | A |

Agentic mode is where token volumes rise 10 to 100 times and where subscription weekly caps and API input costs bite hardest.

### 4.5 Growth and time settings

Demand growth (default 10%/yr), annual price change per option (6.13), discount rate (0% Single user, 5% business tabs), GST convention (6.13), value of time (off).

---

## 5. Options compared

| Family | Variants | Meters | Upfront | Recurring | Capacity limit | Data location |
|---|---|---|---|---|---|---|
| **Local (own)** | Best config or fleet, plus 2 alternates | Ownership | Hardware | Electricity, reserve, admin | Cards × batched tok/s × powered hours | Premises |
| **Rent GPU hourly** | Class matched to memory need | Capacity-hours | None | Hours × rate + storage + misc | Rented hours | Provider rack |
| **Rent GPU monthly / VPS / reserved** | Consumer or datacentre class | Capacity-months | None | Monthly fee + misc | 24 h per rented GPU | Provider rack |
| **Subscription** | Consumer: Free, Base, Pro (5×), Max (20×). Org: Business, Enterprise | Seats + windows | None | Seats × price | Allowance × windows, weekly cap | Provider multi-tenant |
| **API** | Best, Previous, Cheap (Premium, Budget offshore optional) | Tokens | None | Tokens × price | Effectively unlimited | Provider multi-tenant |
| **Combination** | Presets or user-built (6.12) | Mixed | Sum | Sum | Per component | Per component |

---

## 6. Calculation model

### 6.1 Model memory

```
weights_GB  = total_params_B × bits_per_weight / 8
kv_GB       = context_k × (0.08 + 0.0035 × total_params_B)      # per concurrent stream
runtime_GB  = 0.8
required_GB = weights_GB + kv_GB × streams + runtime_GB
```

Generic fit for grouped-query attention (about 0.11 GB per 1k tokens at 8B, 0.33 at 70B). Overestimates for many MoE models, which errs conservative. Assumed.

### 6.2 Hardware building blocks

**Platforms:** price (includes CPU, board, PSU, case, SSD, included RAM), included and max RAM, RAM type and effective bandwidth, max GPUs, base watts, market, warranty (yes/no). Server platforms are available in the Small business (21+) band and Enterprise.

**GPU bands**, priced per GB of VRAM (one editable AUD/GB per band so flagship prices do not skew smaller cards). Each band has VRAM size points with their own bandwidth, nameplate watts, idle watts, efficiency η and add-on cost. Card price = VRAM × band AUD/GB + add-on. Bands are split by generation as well as size, because bandwidth sets speed.

**System RAM** priced per GB by type, in steps 16 to 512 GB, capped by platform. Volatile; flagged.

**Unified-memory systems** as complete boxes with a GPU-addressable share.

**Must be new and warranted** toggle (default on for Small business 21+ and Enterprise) removes secondhand bands and platforms. This tests the pack's hypothesis that the secondhand advantage may not carry over to organisations.

Defaults in section 11.

### 6.3 Single-box configuration search

```
for platform in platforms (market + warranty filter):
  for band_row in gpu_rows + [none]:
    for n_gpu in 0..platform.max_gpus:
      for ram in ram_steps:
        cost = platform + n_gpu × card + (n_gpu − 1)⁺ × extra_gpu_cost + extra_ram
        if cost > budget cap: skip
        placement and speed (6.4)
```

No mixed bands in one machine. Placement classes: GPU-only (required ≤ n × VRAM × 0.95), Hybrid (GPU + RAM − 6 GB OS reserve), CPU-only, Unified (pool × 0.75 addressable), No fit.

### 6.4 Single-stream token rate

Generation is memory-bandwidth bound:

```
bytes_per_token = active_params_B × bits_per_weight / 8
gpu_share       = clamp((VRAM_usable − kv − runtime) / weights, 0, 1)
if MoE and gpu_share < 1: gpu_share = min(1, gpu_share + 0.20)     # attention/shared layers on GPU
t_token         = gpu_share × bytes / (η_gpu × BW_gpu) + (1 − gpu_share) × bytes / (η_cpu × BW_ram)
decode_tps      = multi_gpu_factor / t_token          # 1.00 one card, 0.90 layer split
prefill_tps     = decode_tps × prefill_multiplier     # GPU modern 20, legacy 8, hybrid 6, CPU 4, unified 6
```

Show low / mid / high from the η band. Multi-GPU layer split lets a bigger model fit but does not add single-stream speed.

**Calibration:** fitted η against the picker's 8B benchmarks is about 0.43 to 0.55 for Maxwell/Pascal and 0.57 to 0.85 for Turing and newer. A calibration table in Configuration shows benchmark vs estimate per card.

### 6.4a Selecting the local configuration

(Restored from v0.1 section 5.5; omitted in error from v0.2.)

**Fixed model mode.** Filter configurations with placement other than No fit and mid decode_tps at or above the minimum speed (per-user speed at peak for shared machines). Rank by the chosen objective:
- *Fastest within budget*: highest mid tok/s, tie-break lower cost.
- *Cheapest that meets minimum*: lowest cost, tie-break higher tok/s. This is the objective used when the budget cap is "auto".
- *Best value*: highest tok/s per AUD.

Show the top result plus up to two alternates of a different placement class where available (for example "GPU-only, AUD 1,850, 33 tok/s" and "Hybrid, AUD 1,200, 14 tok/s").

**Budget only mode.** Walk a model-size ladder from largest to smallest and return the largest rung with at least one qualifying configuration, then apply the objective. Never return a size between rungs. Default ladders (editable in Settings):
- Dense: 1, 3, 4, 7, 8, 12, 14, 24, 27, 32, 49, 70, 123
- MoE (total / active): 16/3, 30/3, 80/3, 106/12, 117/5, 235/22

**Quality target mode** (Pick a plan). The quality target (2.4) sets a size range; the engine tries the ladder rungs inside that range, smallest first, and takes the cheapest qualifying configuration.

**No fit.** Never show an empty result. Display:

> No configuration within AUD {budget} can run a {size}B {arch} model at {min_tps} tok/s or better.
> Nearest options: run up to **{largest_fit}B** within this budget; or raise the budget to about **AUD {cheapest_fit_cost}**; or lower the minimum speed to {best_available_tps} tok/s; or try an MoE model of similar total size.

All four suggestions are computed by the engine (search the ladder downward, search budgets upward, report the best tok/s found, and rerun with the MoE ladder), not static text.

### 6.5 Batched throughput (shared machines)

With a batching engine (vLLM or similar), aggregate throughput rises with concurrent streams but saturates:

```
G(c)          = c / (1 + (c − 1) × β)                 # β default 0.15 → G(4)=2.8, G(8)=3.9, G(16)=4.9
aggregate_tps = decode_tps × G(c)
per_user_tps  = aggregate_tps / c                      # must stay ≥ minimum speed
c_max         = limited by (VRAM − weights − runtime) / kv_GB  and by the speed floor
```

Prefill gains little from batching (already compute bound): aggregate prefill = single-stream prefill. The Single user tab uses c = 1 unless the user runs parallel agents (input: parallel agents, default 1).

The Hidra scaling curve (independent streams across cards) applies here, not to single-user large models.

### 6.6 Fleet sizing (Small business and Enterprise)

1. Find the qualifying per-box or per-server configuration for the model class (cheapest per unit of aggregate throughput).
2. `boxes = ceil(cards_needed / cards_per_box)` using 3.2.
3. Build the capacity **staircase**: as users grow, capacity steps up box by box. Plot it against demand (section 7).
4. Apply the tab's PUE to all energy (1.0 unless changed for Small business 2 to 20).

Rental fleets use the same method with rental classes.

### 6.7 Demand

(v0.4: the task layer, 2.8, uses per-task-type counts. The token totals below remain for the 24-hour profile, energy and the existing capacity figures. The `efficiency(size class)` term is now the verbosity factor only, 2.5.)

```
local_demand = (interactive + agent) tokens, output × thinking × efficiency(size class)
cloud_demand = (interactive + agent) tokens, output × thinking × cloud_verbosity
growth       = demand × (1 + growth)^year
annual_days  = days_per_week × 52
```

Effective size for size class and capability band: total params for dense, √(total × active) for MoE (rule of thumb, assumed).

### 6.8 Local cost

```
capex         = hardware (+ admin setup one-off); repurchase at end of life if the horizon is longer
reserve/yr    = capex × 5% (secondhand) or 2% (new)
residual      = off by default; when on, 15% at end of life, linear
load_W        = base_W + n × nameplate × 0.60 (band 0.45 to 0.75) + 40 W CPU offload (hybrid/CPU)
idle_W        = base_W + n × idle_W_card
energy/day    = [busy_h × load_W + (powered_h − busy_h) × idle_W] / 1000 × PUE
energy_AUD    = split by tariff period (unattended work defaults to off-peak under TOU)
demand_charge = contestable only: peak kW × AUD/kW/month
admin_AUD     = hours/month × rate, or FTE share × FTE cost
utilisation   = busy_h / powered_h                     # shown as a metric
```

Supply charges excluded by default (paid anyway); toggle includes them.

### 6.9 Rental cost

```
class      = smallest rental class holding the model on GPU (override allowed)
hourly/day = (span or busy hours + 0.25 h × sessions) × rate × FX + storage/30
monthly    = fee × FX + misc × FX (per rented GPU in a fleet)
admin      = same as local (you run the stack)
```

### 6.10 Subscription cost and capacity

```
allowance/window = 200,000 tokens × tier multiplier × model-class multiplier
                   (Free 0.1, Base 1, Pro 5, Max 20; Business 1.5, Enterprise 5; Best 1.0, Previous 1.5, Cheap 4.0)
usable windows   = ceil(span_h / window_h) (+ unattended hours if agents run through the subscription)
capacity/day     = min(allowance × windows, weekly_cap / days_per_week)
sustained_tps    = allowance / (window_h × 3600)          # total tokens
seats            = all staff or active users (3.3)
lockout_h/day    = from the 24 h simulation
```

Overflow when demand exceeds allowance: *Unmet* (coverage below 100%), *Upgrade* (move that persona to the next tier), or *Top up with API*. Default: Upgrade in Single user, Top up in the business tabs.

**This allowance is the least certain input in the model.** It is flagged next to every subscription figure and included in the tornado chart.

(v0.4: allowance use per task counts cached input at `sub_cache_weight`, 2.8. Per-task window fit and weekly-cap fit are gates in 2.8. The Free tier has no agent tools and a 32k context by default, assumed.)

### 6.10a Request-limited plans (new in v0.4)

Free models reached through a broker are limited by requests, not tokens.

```
weekly_requests = requests_per_day × days of use (D2 convention)
own capacity    = tasks filled smallest first until weekly_requests is used (2.8)
min time/task   = requests / requests_per_min minutes
attempts        = 1 / (p × reliability)          # failed requests still count against the limit
monthly cost    = one-off credit purchase (if any), otherwise 0
```

Two default rows: "Free models via a broker" (50 requests/day) and "Free models via a broker, after USD 10 credit" (1,000 requests/day, USD 10 upfront). Both carry the `may_train` data flag. Limits are sourced (OpenRouter documentation, checked 26 September 2026); reliability and quality are assumed.

### 6.11 API cost

```
daily = [in × (1 − cached) × p_in + in × cached × p_in × (1 − 0.90) + out × p_out] / 1e6 × (1 + markup)
```

Cached share defaults: 0% chat, 20% documents, 70% agentic. (v0.4: per-task `cacheable_share` in 11.11 is used by the task layer.)

### 6.11a Pay-as-you-go top-up (new in v0.4)

Makes every option deliver the same completed week, so their totals compare fairly. Setting `rules.top_up` (default on).

- For each leftover task (2.8), the fallback is the **cheapest API class** that passes all gates for that task with p ≥ 0.95 and passes the option's sensitivity rules. If none qualifies, the task stays undone.
- Top-up cost is metered monthly, follows API price change and demand growth, and is added to the option's TCO series. It is shown separately as "Top-up per month".
- Top-up processing time counts toward processing hours and waiting time, plus `tasks.handoff_min` (default 2 minutes, assumed) per topped-up task.
- With top-up off, an option can only win if its own share is 100%.

This is the v1 form of combinations. The routing matrix in 6.12 is deferred to v2.

### 6.12 Combinations

A combination has up to three components and a **routing matrix**: rows are task types (the pack's five plus Agentic), columns are components. Each cell holds a share (rows sum to 100%). Each component has an overflow target.

Rules:
- Tasks inside the **sensitive share** can only route to components whose data stays on premises.
- Each component is sized for the demand routed to it: a local box sized to its share, seats only for the users who need interactive access, and API billed for whatever flows to it.
- Cost = sum of components. Capacity and coverage are checked per component.

Presets:

| Preset | Routing | Why |
|---|---|---|
| Subscription + local batch box | Interactive → Base or Business seats; agentic, unattended and sensitive → local | Fast interactive work plus unlimited overnight work |
| Local + API overflow | Everything → local until capacity; overflow → API (matched class) | Own the base load, rent the peaks |
| Tiered seats | Power users → Pro/Max or Business; typical and light → API via an internal portal | Stop paying seats for light users |
| Private local + enterprise seats | Sensitive tasks → local; everything else → Enterprise | Pass governance without buying frontier hardware |

Combinations are ranked alongside single options in every chart and in the recommendation.

### 6.13 Time effects

- **Annual price change** per family (defaults, assumed): API −15%/yr, subscriptions 0%, rental −10%/yr, electricity +3%/yr. Hardware is paid upfront; repurchase at end of life uses a separate hardware price change (default 0%).
- **Discount rate** converts monthly cash flows to present value (0% shows nominal).
- **GST:** one toggle shows all figures incl. or ex. GST. Pack AUD prices are converted USD list prices (treated as ex GST; overseas digital services add 10% GST for consumers). Secondhand private sales carry no GST. Tariffs: check whether the published rate includes GST. Default: incl. GST in Single user, ex GST in the business tabs. The global GST control overrides.

### 6.14 Horizon series, break-even, payback and ROI

Monthly series, months 0 to 60, for every option and combination:

- **Cumulative TCO** (nominal or present value). For rented, subscription and API options this is total cost of access; the same term is used for all options so the lines are comparable.
- **Cumulative net saving of A vs B** = cumulative TCO_B − cumulative TCO_A. For local it starts at −capex.
- **Break-even point** = the month where two cumulative TCO lines cross (equivalently, where net saving first reaches 0), or "not within 5 years". For an upfront purchase, the time to reach it is the **payback period**.
- **ROI at horizon** = net saving / capex, reported as a single percentage in the table, not as a chart.
- **Break-even by size:** repeat at user counts 1, 2, 5, 10, 20, 50, 100, 200, 500, 1,000, 2,000, 5,000 → TCO per user per month at the horizon. Report "local breaks even with X at about N users".
- **Cost per completed task** = TCO (including top-up) / tasks completed over the horizon. With top-up on, tasks completed equals all tasks.

### 6.15 Recommendation

1. Filter: completed week (own share 100%, or 100% after top-up), local speed ≥ minimum, sensitivity rules pass. (v0.4: the "biggest task" session veto, decisions D19, is removed; session time only makes cells Slow.)
2. Rank by TCO at horizon, at the matched quality target.
3. Robustness: swing each banded parameter to low and high one at a time. If the winner never changes, label *robust*; otherwise name the parameter that flips it and where.
4. Plan-advice text:

> For **{tab, N users, usage preset, mode}** at **{quality target}** quality with **{sensitivity}** data, choose **{winner}**. Over {horizon} years it costs about **AUD {tco}** ({per user per month}), versus AUD {runner_up_tco} for {runner_up}. It breaks even with {runner_up} at month {break_even}. Confidence: **{robust | sensitive to X}**. {one-line caveat}
>
> (v0.4 additions) On its own it does **{own_share}** of your work; the rest goes to **{top-up classes}**, included in the price. If the winner is a free service: also name the cheapest option that is not free, and say what the free route involves (request limits, slower and less reliable replies, data terms). If the winner carries the `may_train` flag, say so.

**Sensitivity rules** (editable): *Sensitive* vetoes hourly marketplace rental, consumer subscriptions and non-enterprise API, and flags monthly rental and budget-offshore API. *Internal* flags only. *Public* applies none. Vetoed options stay visible, greyed, with the reason.

---

## 7. Outputs and charts

**v0.4: "Can it do your week?" grid.** Rows are options, columns are task types (with counts). Each cell shows Yes / Slow or limited / No in text (not colour alone) with its reason, time per task, and the top-up service for leftovers. A first column shows "On its own" (own share). The grid sits directly under the plan advice in the simple view and near the top of the full workbench. The comparison table gains "On its own" and "Top-up per month" columns. The simple view gets a "Use my own week" editor for task counts, and two rules: top-up on/off, and leave out services that may train on my data.

Every size tab follows the same skeleton so users can move between them without relearning the page: banner, inputs, recommendation, cumulative TCO chart, comparison table, then the tab's emphasised charts, then the rest collapsed under "More charts".

| Position | Single user | Small business | Enterprise | Compare sizes |
|---|---|---|---|---|
| Hero chart | Cumulative TCO / payback | Cumulative TCO / payback | Cumulative TCO / payback | Winner map |
| Second | 24-hour delivery profile | Capacity vs demand (staircase) | Fleet staircase by adoption scenario | Break-even by size |
| Third | Waiting time | Combinations compared | Governance flags and sensitivity routing | Cost per user per month by size |
| Hardware panel | Local hardware card, or Hardware explorer with budget frontier | Fleet panel | Fleet panel | n/a |
| Collapsed | Remaining charts | Remaining charts | Remaining charts | Assumptions held constant |

Each size tab also shows a small **"Where you sit"** thumbnail of the winner map with its own scenario outlined, linking to Compare sizes.

Chart definitions:

1. **Cumulative TCO chart (primary chart).** Toggle between *Cumulative TCO* (all options) and *Payback vs [chosen option]* (cumulative net saving, crossing zero at break-even). Months 0 to 60, one line per option and combination, matched quality solid, cloud Best dashed. Break-even points labelled ("Local breaks even with Pro at month 14"). The horizon and hardware end-of-life are marked, with repurchase steps visible. Low/high bands shown as a shaded ribbon on the leading two lines.
2. **Break-even by organisation size.** x = users (log, 1 to 5,000), y = TCO per user per month at the horizon. The local line shows the staircase as boxes are added. Break-even points labelled.
3. **Winner map.** Heatmap: x = organisation size, y = usage intensity preset; each cell coloured by the recommended option, shaded by the winning margin. Hover shows the runner-up and margin. The current scenario cell is outlined. This is the plan-picker at a glance.
4. **24-hour delivery profile.** Cumulative demand vs delivered tokens in 5-minute steps: subscription burst, plateau and reset (lockout shaded); local steady and continuing overnight.
5. **Capacity vs demand.** Bars of SQ/day per option with a demand line; for fleets, the staircase against user count.
6. **Cost per successful task** (log toggle).
7. **Waiting time per user per year** (hours), and in AUD if value of time is on.
8. **Sensitivity tornado** on the TCO gap between the winner and runner-up.
9. **Budget frontier** (Hardware explorer): budget AUD 250 to 10,000 (or to 500,000 for organisations) vs largest model runnable at the minimum speed, tok/s as a second series.

**Comparison table** columns: upfront, monthly average, TCO at 1 to 5 years, per user per month, break-even month vs local, ROI at horizon, capacity SQ/day, coverage, per-user tok/s, lockout h/day, wait hours/user/yr, utilisation (owned/rented), cost per successful task, context check, data location, sensitivity flag.

**Local hardware card** (single box or fleet summary): platform, GPU band × count, RAM, placement, cost breakdown, memory required vs available bar, decode and prefill tok/s (low/mid/high), batched aggregate and per-user speed, capability band, load and idle watts, number of boxes.

---

## 8. Fit checks

**Context window.** For each task type, the required context (input plus expected output plus thinking) is compared against each option's context: the local configuration's context setting (which also drives memory) and each cloud class's window (editable: Best 200k, Previous 128k, Cheap 128k, assumed). A failure shows as a red flag in the table and excludes that option for tasks routed to it.

**Features checklist** (per option, editable yes/no): web search, file upload and handling, code execution, image input, voice, integrations/apps, admin console, SSO, audit logs, no-training commitment, data residency choice. Shown beside costs. Not scored in v1.

---

## 9. Behaviour requirements

- Live recalculation (debounce 150 ms). The single-box enumeration must finish under 100 ms; the winner map (about 60 cells) under 1 s, computed in a Web Worker if needed.
- Every number has a tooltip with the formula, inputs and their provenance. Teaching mode shows these inline.
- AUD throughout; FX is a parameter.
- Tokens and SQ are never mixed without labels.
- Keyboard accessible, usable at 380 px width, print stylesheet (inputs, recommendation, cumulative TCO chart, winner map, table on two A4 pages).

**Tabs**
- One engine: `compute(config, inputs)` is identical for every tab. A tab is a bundle of `{defaults, visible_inputs, chart_order}`.
- Each tab keeps its own `inputs` object. Switching tabs never overwrites another tab's inputs. Tabs not on screen recompute lazily when opened.
- Settings edits apply to all tabs, except size-dependent defaults (3.1), which each tab holds separately.
- The URL hash stores the active tab plus that tab's inputs, so a shared link opens the same tab and scenario.
- Tabs on mobile collapse to a segmented control; Compare sizes stays reachable.

---

## 10. Settings panel

Tabbed tables with columns: value, low, high, unit, **status** (sourced / estimated / assumed / user-supplied), source, date, note. Editing a sourced or estimated value changes it to *user-supplied* automatically and keeps the original in the tooltip.

Sections (as tabs inside the panel): Hardware · Speed model · Power and electricity · Ownership and admin · Organisation sizes · Rental · Subscriptions · API · Workload and usage modes · Quality targets and efficiency · Combinations · Time effects · Fit checks · Presets.

Presets: "LocoLabo defaults (this spec)", "Picker snapshot prices (18 Apr 2026)", "Pessimistic for local", "Optimistic for local", and user-saved.

Import/export the whole configuration as JSON. v1.1: import the data pack CSVs directly. Persistence via `localStorage` when standalone (not available inside a Claude artifact, so rely on JSON export there). URL hash stores the primary inputs for sharing.

---

## 11. Default parameters

AUD unless stated. **S** sourced, **E** estimated (data pack), **A** assumed (this spec, verify before a report).

### 11.1 GPU bands

| Band | Market | AUD/GB | Picker-snapshot AUD/GB | Size points (VRAM: BW GB/s, nameplate W, idle W, η mid) | Add-on | Status |
|---|---|---|---|---|---|---|
| Small modern (6 to 16 GB) | Secondhand | 28 | 37 (excl. 5080) | 8: 448, 175, 15, 0.65 · 12: 360, 170, 18, 0.60 · 16: 288, 165, 20, 0.65 | 0 | A |
| Large modern (24 GB) | Secondhand | 46 | 32 | 24: 936, 350, 18, 0.70 | 0 | A |
| Flagship consumer | New | 130 | not usable (15.2) | 16: 960, 360, 22, 0.72 · 24: 1008, 450, 20, 0.78 · 32: 1792, 575, 22, 0.65 | 0 | A |
| Legacy server | Secondhand | 18 | 17 (excl. M40) | 16: 732, 250, 12, 0.55 · 24: 346, 250, 12, 0.50 · 32: 900, 300, 16, 0.60 | 40 | A |
| Datacentre | New, warranted | 270 (48 GB) / 625 (80 GB) | n/a | 48: 864, 350, 35, 0.70 · 80: 2000, 350, 50, 0.70 | 0 | A, verify |

Bandwidth and watts for consumer and legacy rows are from the picker and power files (S/E). All AUD/GB values need re-pricing.

### 11.2 Platforms

| Platform | Market | Price | Incl. RAM | Max RAM | RAM, eff. BW | Max GPUs | Base W | Status |
|---|---|---|---|---|---|---|---|---|
| Office SFF desktop | Secondhand | 400 | 16 | 64 | DDR4, 40 | 1 (low profile) | 35 | A (W from Hormiga, E) |
| Tower desktop | Secondhand | 900 | 32 | 128 | DDR4, 50 | 2 | 55 | A (W from Puente, E) |
| New desktop | New | 1,600 | 32 | 192 | DDR5, 80 | 2 | 60 | A |
| Used workstation (X99/Xeon) | Secondhand | 1,000 | 64 | 256 | DDR4 quad, 70 | 4 | 120 | A (W from Hidra, E) |
| Unified-memory mini PC | New | 3,500 | 128 fixed | 128 | Unified, 256 | 0 | 20 idle / 140 load | A |
| 4-GPU server | New, warranted | 15,000 | 256 | 1,024 | DDR5 8-ch, 250 | 4 | 400 | A |
| 8-GPU server | New, warranted | 30,000 | 512 | 2,048 | DDR5 12-ch, 350 | 8 | 800 | A |

RAM: DDR4 AUD 3/GB, DDR5 AUD 7/GB (A, volatile). Extra GPU AUD 150 (A).

### 11.3 Electricity (E, verify against Synergy)

| Preset | c/kWh low/mid/high | Supply AUD/day | TOU peak / off-peak | Demand charge |
|---|---|---|---|---|
| Residential (SWIS A1) | 29 / 32 / 35 | 1.20 | n/a | n/a |
| Small business | 33 / 39 / 45 | 1.30 | 45 / 18 | n/a |
| Small business TOU | 24 / 30 / 36 | 1.30 | 48 / 16 | n/a |
| Contestable (>50 MWh) | 22 / 28 / 35 | 0 | 35 / 15 | AUD 8 to 20 per kW per month |

TOU hours assumed (off-peak 21:00 to 07:00); check.

### 11.4 Power (E)

Inference 0.60 of nameplate (0.45 to 0.75). Idle per card from `power_estimates.csv`. CPU offload +40 W (A). PUE per tab (A).

### 11.5 Ownership and admin (A)

Life 4 years secondhand, 5 new. Reserve 5% / 2% per year. Residual off (15% at end of life when on). Admin per 3.1. Paid-help setup AUD 300 (Single user and Small business).

### 11.6 Rental (E, USD)

| Class | VRAM | BW | Hourly | Reserved monthly | GPU VPS monthly | Status |
|---|---|---|---|---|---|---|
| 24 GB (4090 class) | 24 | 1008 | 0.40 to 0.65 | 300 to 600 | 450 to 800 | E |
| 48 GB (2 × 24 GB) | 48 | 1008 × 0.9 | 0.80 to 1.30 | 600 to 1,200 | 900 to 1,600 | A |
| 80 GB (A100 class) | 80 | 2039 | 1.20 to 1.80 | 1,000 to 1,600 | n/a | E (BW A) |
| 80 GB (H100 class) | 80 | 3350 | 2.00 to 3.50 | n/a | n/a | E (BW A) |

Misc USD 20/month (0 to 120, E). Session overhead 0.25 h, persistent storage USD 10/month (A). Rental η 0.70 (A).

### 11.7 Subscriptions

| Tier | AUD/seat/month | Allowance multiplier | Status |
|---|---|---|---|
| Free | 0 | 0.1 | A |
| Base | 30.80 | 1 | Price E |
| Pro | 154.00 | 5 | Price E (pack's 5× tier) |
| Max | 308.00 | 20 | A |
| Business | 38.50 | 1.5 | Price E, multiplier A |
| Enterprise | 92.40 (band 77 to 123) | 5 | Price E, multiplier A |

Base allowance 200,000 tokens per 5 h window on Best (band 100,000 to 600,000). Weekly cap 12 full windows. Model-class multipliers Best 1.0, Previous 1.5, Cheap 4.0. Burst speed Best 60, Previous 80, Cheap 150 tok/s; TTFT 1.5 s. All A.

v0.4 additions, all A unless stated: Free tier context 32k, no agent tools, quality High. Subscription cache weight 0.1.

**Request-limited plans (6.10a)**

| Plan | Requests/day | Requests/min | Upfront | Quality | Context | Agent tools | Reliability | Data | Status |
|---|---|---|---|---|---|---|---|---|---|
| Free models via a broker | 50 | 20 | 0 | High | 128k | Yes | 0.70 | may_train | Limits S (OpenRouter docs, 26 Sep 2026); rest A |
| Free models via a broker, after USD 10 credit | 1,000 | 20 | USD 10 | High | 128k | Yes | 0.70 | may_train | Limits S; rest A |

### 11.8 API (AUD per million tokens, E)

| Class | Input | Output | Basis |
|---|---|---|---|
| Best | 2.83 | 17.97 | Mean of frontier rows |
| Previous | 1.70 | 10.78 | A: 0.6 × Best |
| Cheap | 0.69 | 4.36 | Mean of small rows |
| Premium | 23.10 | 115.50 | Verify (15.4) |
| Budget offshore | 0.85 | 3.39 | Sensitivity flag |

Cache discount 90%, intermediary markup 0% (0 to 15%).

### 11.9 Efficiency factors and capability bands (A, from pack)

| Effective size | Factor | Band |
|---|---|---|
| Under 5B | 2.16 | Simple extraction and drafting (55 to 67) |
| 5 to 20B | 1.56 | Routine tasks, more re-asks (68 to 71) |
| 20 to 50B | 1.21 | Close to small-cloud (about 78) |
| Over 50B | 1.10 | Extrapolated (80 to 85) |
| Cloud Cheap / Previous / Best | 1.10 / 1.05 / 1.00 | 80 to 88 / A / 90+ |

### 11.10a Success rates (A, new in v0.4)

| Quality gap (needed − option) | Success rate p |
|---|---|
| 0 or less | 0.95 |
| 1 | 0.60 |
| 2 | 0.25 |
| 3 or more | 0.05 |

Minimum usable success rate `p_min` 0.30. Session tolerance 15 min (existing), agent tolerance 120 min, hand-off 2 min per topped-up task. All banded for the tornado: p for gap 1 (0.4 to 0.8), gap 2 (0.1 to 0.4), p_min (0.2 to 0.5).

### 11.11 Task types (A except pack token counts, new in v0.4)

| Task | Steps | Input/step | Output/step | Cacheable | Quality needed | Agent tools |
|---|---|---|---|---|---|---|
| Quick Q&A (pack) | 1 | 500 | 500 | 0% | Basic | No |
| Document summary (pack) | 1 | 6,000 | 800 | 0% | Good | No |
| Writing / drafting (pack) | 1 | 1,000 | 1,200 | 0% | Good | No |
| Coding assistance (pack) | 1 | 2,000 | 1,500 | 0% | High | No |
| Analysis / RAG (pack) | 1 | 10,000 | 1,000 | 0% | High | No |
| Agentic task | 20 | 15,000 | 800 | 70% | High | Yes |
| Hard problem (optional, 0 by default in the mixes) | 10 | 20,000 | 2,000 | 50% | Frontier | No |

Context need is computed per step unless overridden (2.8).

### 11.10 Concurrency and time (A)

Peak-hour share 0.20, headroom 1.3, batching β 0.15, demand growth 10%/yr, price changes per 6.13, discount rate 0% / 5%.

---

## 12. Disclaimers (UI text)

1. **Estimates, not measurements.** Speeds come from a bandwidth model calibrated to published benchmarks. Read the low/high band, not just the middle.
2. **Model size is a proxy for capability.** Quality targets and bands are indicative.
3. **Same job, different token counts.** Smaller models need more tokens and attempts. The efficiency factor is an assumption.
4. **Subscription allowances are not published** and change often. Replace the default with your own experience.
5. **Prices move,** in both directions and fast. All prices are dated snapshots. Secondhand prices vary widely and exclude postage.
6. **DIY assumed for individuals.** Turn on paid help if you can't set it up yourself. Organisations include admin labour by default.
7. **Secondhand risk:** no warranty, possible early failure, uncertain supply.
8. **Long unattended runs:** smaller models are more likely to drift or fail on long agentic tasks. Capacity is not the same as useful output.
9. **Shared machines slow down under load.** Per-user speed at peak is shown; batching needs a suitable serving engine.
10. **Not modelled:** heat, noise, space, troubleshooting time beyond the admin setting, internet outages, security patching.
11. **Data location is not just a cost.** The sensitivity rules are a screen, not a privacy assessment.
12. **Not financial or tax advice.** GST and depreciation treatment depend on your circumstances.

---

## 13. Acceptance tests

Mid-band defaults. Tolerance ±10% unless stated.

| # | Scenario | Expected |
|---|---|---|
| T1 | 8B dense Q4, 16k ctx, 12 GB small-modern | GPU-only, about 46 tok/s (picker 3060: 42, within ±25%) |
| T2 | 32B dense Q4, 8k, 24 GB large-modern | 21.7 GB, GPU-only, about 31 tok/s |
| T3 | 30B MoE (3B active), 12 GB + 32 GB DDR4 | Hybrid, active GPU share 0.70, about 35 tok/s (25 to 45) |
| T4 | 70B dense Q4, 4k | 1 × 24 GB + RAM about 1 tok/s, rejected; 2 × 24 GB GPU-only about 13 tok/s |
| T5 | Budget AUD 300, 70B, Fixed mode | No-fit message with computed alternatives |
| T6 | Single user, Typical, Chat, API Best, thinking Off | About AUD 0.35/day, AUD 10.70/month |
| T7 | 73 W idle, always on, 32 c/kWh | About AUD 205/yr at zero usage |
| T8 | Inference factor 0.45 → 0.75 | Only local energy and local TCO change |
| T9 | Base sub, 200k per 5 h | Sustained about 11 tok/s; Power persona about 38 SQ/window |
| T10 | Edit a sourced value | Status becomes user-supplied, original in tooltip |
| T11 | Budget-only, AUD 2,000 | Returns a ladder rung, never an in-between size |
| T12 | Sensitive data rule | Vetoed options greyed with reason, still costed |
| T13 | Open Enterprise tab after Single user | Tariff, seat tier, admin, PUE and hardware market show Enterprise defaults; Single user inputs unchanged when you switch back |
| T14 | Batching β 0.15 | G(4) = 2.8, G(8) = 3.9, G(16) = 4.9 |
| T15 | Enterprise, 500 staff, 50% adoption, 10/40/50, Good quality on 24 GB large-modern | 3,125 SQ/day, 625 peak-hour SQ, about 14 card-seconds per SQ at 8 streams, 3.1 cards after headroom, so 4 cards (show the working) |
| T16 | "Local + API overflow" with local capacity below demand | Overflow tokens billed at matched API class; coverage 100% |
| T17 | Winner map cell for the current scenario | Identical to the main recommendation |
| T18 | Payback view | Break-even month equals the first month cumulative net saving ≥ 0, and matches where the two cumulative TCO lines cross |
| T19 | RAG task (10k input) routed to a local config at 8k context | Context check fails and flags |
| T20 | Thinking Off → High | Output tokens × 6 on every option; local wait time and cloud cost both rise |
| T21 | Small business staff 18 → 25, with tariff previously edited by user | All 21+ defaults apply except tariff, which keeps the user's value; undo restores the previous state |
| T22 | Small business staff set to 250 | Input clamps at 200 and offers "Open in Enterprise", which copies shared inputs |
| T23 | Small business at 200 staff and Enterprise at 200 staff with identical inputs and defaults overridden to match | Identical results (one engine) |
| T24 | Shared link | Opens the same tab with the same inputs |
| T25 | Compare sizes "based on" Small business | Sweep uses that tab's usage mode, quality target, sensitivity and thinking level; assumptions list says so |

T6 and T7 together are the early reality check: for one typical user on flat residential power, an always-on box can cost more in idle electricity than the API costs in total. T15 is the counterweight: at institutional scale, a few batched cards can serve hundreds of users. The page must show both clearly.

---

### 13.1 Task layer tests (new in v0.4)

Defaults unless stated. Thinking Low (1.5) unless stated.

| # | Scenario | Expected |
|---|---|---|
| N1 | Free chat tier, Agentic task | No, reason "No agent or coding tools". Quick Q&A on the same option: Yes |
| N2 | Analysis/RAG with context need overridden to 45k, local context 32k | Local cell No, reason names 45k and 32k |
| N3 | High-quality task on a Good option | p 0.60, attempts 1.67; tokens, cost and time per task all × 1.67 vs a High option at p 0.95 scaled to the same basis; cell Slow |
| N4 | Gap 2 / gap 3 | Gap 2: p 0.25, Slow. Gap 3: No, "Model too weak for this task" |
| N5 | Agentic step, 15,000 input, 70% cacheable, 800 output | Local reprocesses 4,500 tokens per step. Allowance use per step 4,500 + 1,050 + 1,200 = 6,750; per task 20 / 0.95 × 6,750 ≈ 142,100 units: fits one 200k Base window; spans 2 windows at a 100k allowance |
| N6 | Free chat tier (20k window, no weekly cap), Hard problem | Slow, spans 12 windows, wall at least 55 h (10 steps × 14,000 units / 0.60 = 233,300 units) |
| N7 | Broker free (50/day, reliability 0.70), Agentic task | 20 / (0.95 × 0.70) ≈ 30.1 requests per task: fits one day; weekly request capacity limits the count done |
| N8 | Top-up on | Every option (with at least one qualifying API class per task) completes 100% of the week; top-up cost equals leftover tasks × cheapest qualifying API cost per task |
| N9 | Edit `retry_or_rerun_factor` | No output changes (wiring test: the factor is unused) |
| N10 | Local build whose Agentic task exceeds the session tolerance | Option still eligible to win; cell Slow with the time |
| N11 | Capacity for about half the week | Tasks filled smallest first: Quick Q&A fully done before Analysis/RAG |

Existing tests: change an expected value only where CR-001 explains why, and list every such change in `docs/decisions.md`.

## 14. Implementation notes

- Single self-contained HTML file, vanilla JavaScript, no build step. Chart.js 4 from cdnjs (inline option for offline). Web Worker for the winner map and break-even-by-size sweeps.
- One `config` object (parameters with metadata), one `inputs` object, a pure `compute(config, inputs) → results`, separate renderers. `?test` runs T1 to T20.
- Parameter record:

```json
{
  "id": "power.inference_factor",
  "label": "Inference draw as share of nameplate",
  "value": 0.60, "low": 0.45, "high": 0.75, "unit": "ratio",
  "status": "estimated", "source": "LocoLabo data pack, power_estimates.csv",
  "source_date": "2026-08-31", "note": "Text generation is bandwidth bound; nameplate is a ceiling"
}
```

- Combination record: components (option id, tier, class), routing matrix (task type × component shares), overflow targets.
- 24 h simulation in 5-minute steps; demand spread over the span with the peak-hour share, agent work queued into unattended hours.
- Store watts, GB, tokens and AUD; convert only at display.

---

## 15. Issues found in the data pack

1. **Persona totals vs task mix:** 120k / 30k / 6k tokens/day stated, about 208k / 56k / 12k implied by mix × queries. Choose one source of truth.
2. **Open-ended top price bracket:** 4090, 5080 and 5090 share AUD 1,434 mid (a floor), and brackets are shared across very different cards. Re-price before deriving $/GB.
3. **Tesla M40 benchmark:** implies η about 0.20 against 0.43 to 0.85 elsewhere. Re-check.
4. **Premium API row (USD 15 / 75):** verify; premium-tier pricing has moved.
5. **20× subscription tier (USD 200)** is missing; added as assumed.
6. **Hidra curve** assumes independent parallel streams. Valid for multi-user batching (6.5), not for one large model split across cards.
7. **Energy per token uses 8B throughput;** the comparator recomputes from its own tok/s.
8. **"Local models give the same answer without hidden tokens"** (efficiency file, reasoning row) is not true when running local reasoning models. Thinking should apply to both sides (2.6).
9. **Default context vs task mix:** the Analysis/RAG task (10k input) needs more than 8k context.
10. **Efficiency file mixes two effects.** `equivalent_output_token_factor` (verbosity) and `retry_or_rerun_factor` (failures) are separate things. v0.4 keeps the first and replaces the second with task-dependent success rates (2.5, 2.8).

---

## 16. Future extensions

- Hyperscaler IaaS and colocation rows.
- Hardware price direction × cloud price direction 2×2 as a scenario switch (partly covered by 6.13).
- Import measured lab JSON (idle watts, Wh per 1k tokens, Hidra curve) cell for cell.
- Quality-adjusted scoring from a user-chosen benchmark per size class; scoring the features checklist.
- Automatic routing optimiser for combinations (cheapest valid routing matrix).
- Business depreciation and instant asset write-off treatment.
- Solar self-consumption offset for daytime local use; carbon emissions using WA grid intensity.
