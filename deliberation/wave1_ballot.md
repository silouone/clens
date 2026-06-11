# Wave 1 Ballot — cLens Task Prioritization

## Summary Statistics

- **Total Findings:** 38
  - FATAL: 3
  - SERIOUS: 17
  - MODERATE: 14
  - MINOR: 4
- **Total Proposals:** 22

---

## Convergence Map — Pre-Vote Signal Detection

### CLUSTER 1: Publish v0.2.1 immediately (7/7 agents)
- A1: MINOR — v0.2.1 never published despite being production-ready
- A2: SERIOUS — web dashboard lives on unpublished branch
- A3: SERIOUS — v0.2.1 has been ready for 38 days, pure inaction
- A4: (implicit) — auto-distill requires shipping the fix
- A5: SERIOUS — stop adding features until publication
- B1: SERIOUS — 3 GitHub stars, invisible publicly
- B2: SERIOUS — product has no growth surface

### CLUSTER 2: Auto-distill / remove manual pipeline steps (4/7 agents)
- A2: SERIOUS — `distill` is a manual step no one will remember
- A2: SERIOUS — Insights page requires manual "Rebuild Analytics"
- A4: SERIOUS — distill-then-analyze two-step breaks the feedback loop
- B2: MODERATE — 40% of computed analysis never displayed

### CLUSTER 3: Fix first-run / onboarding experience (3/7 agents)
- A2: FATAL — first-run experience is a cliff
- A3: SERIOUS — README install command is wrong (`clens` vs `@silou/clens`)
- B2: SERIOUS — no growth surface, no compelling first impression

### CLUSTER 4: Web dashboard scope freeze / ship MVP (5/7 agents)
- A3: MODERATE — no clear "ship" definition for web
- A5: FATAL — web accumulating design debt faster than acquiring users
- A5: SERIOUS — 85+ specs = planning-to-shipping ratio dangerously inverted
- B1: SERIOUS — Live Mode 95% ready but not shipped
- B2: SERIOUS — web in permanent architectural sprawl

### CLUSTER 5: Make the analytical moat visible (3/7 agents)
- B1: FATAL — competitive moat doesn't survive contact with new entrants (invisible)
- B2: MODERATE — 40% of computed analysis never displayed in web UI
- B2: SERIOUS — no landing page, no screenshots, no demo

### CLUSTER 6: Fix data integrity / structural bugs (3/7 agents)
- A1: SERIOUS — analytics-summary.jsonl missing from web distill path
- A1: SERIOUS — web imports CLI internal source paths
- A5: MODERATE — analytics pipeline has duplicate types that will diverge

### CLUSTER 7: `clens web` broken on npm install (2/7 agents)
- A3: SERIOUS — @clens/web is private, `clens web` crashes on npm install
- A3: SERIOUS — README advertises wrong package name

### CLUSTER 8: Address competitive pressure (2/7 agents)
- B1: FATAL — new entrants (agents-observe, ccboard, karma, otel) closing gap
- B2: SERIOUS — single-provider lock-in is existential risk

---

## All Findings (by agent)

### A1 — Structural Engineer
| # | Finding | Severity |
|---|---|---|
| 1 | analytics-summary.jsonl cache has no invalidation contract (web path missing) | SERIOUS |
| 2 | Web package imports CLI internal source paths directly | SERIOUS |
| 3 | Distill pipeline monolithic — any extractor failure cascades | SERIOUS |
| 4 | Session list fetches 5,000 sessions synchronously | MODERATE |
| 5 | Global multi-repo discovery runs git rev-parse per dir on every start | MODERATE |
| 6 | buildSessionMap rebuilds on every detail request | MODERATE |
| 7 | v0.2.1 never published | MINOR |

### A2 — Human Psychologist
| # | Finding | Severity |
|---|---|---|
| 1 | First-run experience is a cliff | FATAL |
| 2 | distill is a manual step no one will remember | SERIOUS |
| 3 | Web dashboard lives on unpublished branch | SERIOUS |
| 4 | Insights page requires manual "Rebuild Analytics" | SERIOUS |
| 5 | Navigation too flat for power users, too complex for new users | MODERATE |
| 6 | BottomPanel with backtracks starts collapsed — invisible analysis | MODERATE |
| 7 | TUI is 1,553 LOC contributor deterrence | MODERATE |

### A3 — Realist Auditor
| # | Finding | Severity |
|---|---|---|
| 1 | v0.2.1 ready for 38 days, unpublished | SERIOUS |
| 2 | `clens web` broken on npm install (private package) | SERIOUS |
| 3 | README advertises wrong package name | SERIOUS |
| 4 | Web dashboard no clear "ship" definition | MODERATE |
| 5 | SessionSnapshot.tsx dead stub | MODERATE |
| 6 | README badge numbers stale (23 extractors, 1151 tests) | MODERATE |
| 7 | formatTokenCount dead branch | MINOR |

### A4 — Philosopher
| # | Finding | Severity |
|---|---|---|
| 1 | "Observability" metaphor doesn't match reality (forensics, not observability) | SERIOUS |
| 2 | 23 extractors is quantity not quality — users need 3 good ones | SERIOUS |
| 3 | decisions extractor produces noise, not decisions | SERIOUS |
| 4 | Plan drift mechanically broken for most users | MODERATE |
| 5 | Context consumption tracking architecturally incomplete | MODERATE |
| 6 | Web dashboard and CLI architecturally drifting apart | MODERATE |
| 7 | work-units concept underspecified | MINOR |

### A5 — Anarchist
| # | Finding | Severity |
|---|---|---|
| 1 | Web accumulating design debt faster than acquiring users | FATAL |
| 2 | Bun-only runtime is adoption killer | SERIOUS |
| 3 | 85+ specs = planning-to-shipping ratio dangerously inverted | SERIOUS |
| 4 | CLI command surface wider than user base can discover | MODERATE |
| 5 | Analytics pipeline duplicate types | MODERATE |
| 6 | SessionSnapshot.tsx dead stub | MODERATE |
| 7 | Distill I/O leak documented but unfixed | MINOR |

### B1 — Scout
| # | Finding | Severity |
|---|---|---|
| 1 | Competitive moat invisible — new entrants closing gap | FATAL |
| 2 | Live Mode 95% ready but not shipped | SERIOUS |
| 3 | GitHub presence effectively zero (3 stars) | SERIOUS |
| 4 | Context Consumption implemented but not integrated | SERIOUS |
| 5 | No differentiation against OTel/eBPF approaches | MODERATE |
| 6 | Mission Control v3 nav spec written but not executed | MODERATE |
| 7 | clens-web branch has no PR/changelog | MINOR |

### B2 — Strategist
| # | Finding | Severity |
|---|---|---|
| 1 | No growth surface — invisible by default | SERIOUS |
| 2 | Web dashboard in permanent architectural sprawl | SERIOUS |
| 3 | Single-provider lock-in is existential risk | SERIOUS |
| 4 | 40% of computed analysis never displayed | MODERATE |
| 5 | Job-to-be-done unclear between surfaces | MODERATE |
| 6 | Context consumption implemented but treated as future | MODERATE |
| 7 | cLens Cloud/SaaS is vaporware consuming attention | MINOR |

---

## De-duplicated Ballot Items

### BALLOT-1: Publish v0.2.1 to npm immediately
*Proposed by: A1, A2, A3, A5, B1, B2. Converged independently by all 7 agents.*
Merge the clens-web branch (or at minimum the CLI fixes), run prepublishOnly, publish to npm. Stop accumulating features on an unpublished branch. Every day of delay is wasted improvement invisible to users.

### BALLOT-2: Auto-distill on demand — remove manual pipeline steps
*Proposed by: A2, A4. Related findings from A2 (Insights manual rebuild), B2 (invisible analysis).*
When `clens what --last` or any analysis command is run without distilled data, auto-run distill inline. When Insights page loads with distilled sessions but no analytics, auto-rebuild. Goal: user never sees "run command X first."

### BALLOT-3: Fix first-run experience and README correctness
*Proposed by: A2, A3. Related findings from B2 (no growth surface).*
Fix README install command (`@silou/clens` not `clens`). Add post-init banner with 3-step onboarding. Improve empty states in CLI and web. Update stale badge numbers.

### BALLOT-4: Define and lock web dashboard MVP scope, stop spec churn
*Proposed by: A3, A5, B2. Related findings from A5 (85+ specs), B1 (live mode 95% ready).*
Write a one-page MVP definition: which pages must work, which must typecheck, which must build. Everything else is v0.3+. Archive superseded specs. Ban new web specs until current changes ship.

### BALLOT-5: Make the analytical moat visible — screenshots, landing page, launch
*Proposed by: B1, B2. Related findings from B1 (competitive landscape), A5 (invisible publicly).*
Produce killer README screenshot showing backtrack/diff analysis. Ship clens.dev landing page. Post on HN/Reddit. Claim GitHub topic tags. The 23-extractor depth is real but undiscoverable.

### BALLOT-6: Wire existing invisible features into web UI
*Proposed by: B2. Related findings from B1 (computed data never rendered), A4 (moat is quantity).*
Display risk badges from existing `risk-score.ts`. Wire the conversation panel (endpoint works, store unused). Show decisions tab. These are rendering tasks, not analysis tasks — make the moat legible.

### BALLOT-7: Fix data integrity bugs (persistDistillResult, package boundary, duplicate types)
*Proposed by: A1, A5. Related findings from A1 (analytics-summary gap), A1 (deep imports).*
Extract shared `persistDistillResult` helper for both CLI and web distill paths. Add exports map to CLI package.json. Move analytics types to shared/types.ts. Delete SessionSnapshot.tsx.

### BALLOT-8: Fix `clens web` crash on npm install
*Proposed by: A3. Related findings from A1 (web depends on CLI internals).*
Add try/catch around `@clens/web/server` import with clear error message, or bundle pre-built web assets into CLI dist.

### BALLOT-9: Add OTel export to hedge single-provider risk
*Proposed by: B2, B1. Related findings from B1 (claude-code-otel competitor at 332 stars).*
Implement `clens export --otel` that converts distilled session to valid OTLP trace JSON. One-day feature that opens enterprise door and reduces Claude Code lock-in.

### BALLOT-10: Kill the TUI (`clens explore`)
*Proposed by: A5. Related findings from A2 (1,553 LOC contributor deterrence).*
The TUI duplicates web dashboard functionality in a harder-to-maintain form. Removing it saves 1,553+ LOC and forces strategic commitment to web as the UI. CONTESTED — A2 suggests splitting it instead.

### BALLOT-11: Rename "decisions" to "friction points" — conceptual clarification
*Proposed by: A4. Related findings from A4 (noise not decisions).*
Rename `DecisionPoint` to `FrictionPoint` or `EffortSignal`. Rewrite documentation to honestly describe the heuristics. Remove deprecated variants.

### BALLOT-12: Validate/calibrate core extractors against real sessions
*Proposed by: A4. Related findings from A4 (plan drift broken for most users).*
Run backtracks, decisions, and edit chains against 10-20 known sessions where ground truth is known. Adjust thresholds based on evidence.

### BALLOT-13: Add Node.js runtime support
*Proposed by: A5.*
Add Node.js build target for CLI. The hook path only needs `fs`, `path`, `process`. Web server can swap Hono adapter. Removes adoption gate for Windows/corporate environments.
