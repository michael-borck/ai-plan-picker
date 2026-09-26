# Roadmap

Status tracker. Phases in order; change requests in `docs/change-requests/`
are the authority for what changes. Git carries the history: branch per CR,
one commit per work item, tags on spec versions.

## Phase A: repository foundation

- [x] Git init, `.gitignore`, initial commits per area
- [x] MIT licence, README
- [x] GitHub repo `ai-plan-picker` (public) and push
- [x] `docs/data-updates.md` runbook

## Phase B: CR-001 task layer (branch `cr-001-task-layer`)

- [ ] Part A: spec renamed to `docs/spec.md`, tagged `spec-v0.3`, v0.4 spec
      committed, CR and reference engine archived
- [ ] Item 0: CLAUDE.md change-request process, decisions.md CR-001 heading
- [ ] Item 1: configuration (task types, success rates, rules, features,
      broker plan rows, option attributes)
- [ ] Item 2: task layer module (`taskLayer.js`)
- [ ] Item 3: weekly capacity and smallest-first fill, own share
- [ ] Item 4: request-limited plans
- [ ] Item 5: pay-as-you-go top-up in every TCO
- [ ] Item 6: verbosity-only efficiency, retry factor removed
- [ ] Item 7: eligibility = completed week; recommendation text
- [ ] Item 8: "Can it do your week?" grid, table columns, simple-view rules,
      own-week editor, org tabs hidden
- [ ] Item 9: tests N1 to N11, existing expectations updated with reasons,
      example.js prints the grid
- [ ] Item 12: "Pays off at about N times this workload" line
- [ ] Merge to main

## Phase C: command line reports

- [ ] `bin/comparator.js` with `--config`, scenario flags, four formats
- [ ] `--sweep` CSV batch
- [ ] `tests/cli.test.js`, package.json `bin` field

## Phase D: v1 polish (spec catch-up)

- [ ] Spec 6.4a full ladders (dense 1 to 123, MoE 16/3 to 235/22) and the
      computed four-suggestion no-fit message
- [ ] Chart 1 low/high ribbon on the leading two lines
- [ ] Cost per completed task chart with log toggle (spec 7 chart 6)
- [ ] Features checklist display (spec 8)
- [ ] `?test` page mode running the acceptance tests (spec 14)
- [ ] Print stylesheet to two A4 pages; 380 px pass
- [ ] Teaching mode formula lines per result

## Phase E: v2 backlog (deferred, do not start without a CR)

- [ ] Small business, Enterprise and Compare sizes tabs (`features.org_tabs`)
- [ ] Combinations routing matrix (spec 6.12) and its presets
- [ ] Task-ordered lockouts in the 24-hour delivery profile
- [ ] MoE efficiency factor and per-token overhead (reference engine extras;
      needs its own CR)
- [ ] Import data pack CSVs directly (spec 10, v1.1)
- [ ] Hyperscaler IaaS and colocation rows; hardware x cloud price 2x2
- [ ] Automatic routing optimiser; quality-adjusted scoring
