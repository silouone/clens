# cLens Task Prioritization — Deliberative Analysis: Final Brief

**Panel:** 7 agents, 2 waves, 38 findings, 22 proposals, 13 ballot items
**Date:** 2026-04-04
**Convergence:** Achieved in Wave 2 (Agreement Index 92%)

---

## Executive Summary

cLens has a working analytical engine — 23 extractors, hook-based capture, a substantial web dashboard — wrapped in a broken delivery system. The npm package (v0.2.0) crashes on `clens web`, the README lists the wrong install command, first-run shows empty states with no guidance, and the distill pipeline requires manual steps that no user will remember. Meanwhile, competitors (agents-observe at 285 stars, ccboard at 346 commits, claude-code-otel at 332 stars) are shipping and accumulating mindshare while cLens sits at 3 GitHub stars with v0.2.1 unpublished for 38 days. The project does not have a feature problem. It has a delivery problem.

---

## Consensus Findings (locked by supermajority)

### FATAL

| Finding | Source Agents | Evidence |
|---|---|---|
| First-run experience is a cliff — empty states, no guidance, no pipeline explanation | A2, A3, B1 | InsightsPage EmptyState confirmed in source; `clens list` returns nothing on empty project; `clens what --last` throws without prior distill |
| Competitive moat is invisible — 3 stars vs 285-1200 for competitors | B1, B2, A5 | agents-observe (285 stars, v0.7.4 shipped Apr 1), claude-code-otel (332 stars), disler (1,300 stars). cLens: 3 stars, 196 npm downloads |
| Web dashboard accumulating scope without users to validate it | A5, B2, A3 | 12+ web redesign specs, 6 untracked new web files, UI/UX audit at 5.25/10. Zero external user feedback |

### SERIOUS

| Finding | Source Agents |
|---|---|
| v0.2.1 unpublished for 38 days — blocking all user feedback | A3, A1, A2, A5, B1, B2 |
| `clens web` crashes on npm install — private web package, source path imports | A3, A1 |
| README advertises wrong package name (`clens` vs `@silou/clens`) | A3 |
| Manual distill step — no competitor requires it, kills week-6 retention | A2, A4 |
| Analytics-summary cache not written from web distill path | A1 |
| Web package imports CLI internal source paths directly | A1 |
| 85+ spec files — planning-to-shipping ratio dangerously inverted | A5 |
| No growth surface — no screenshots, no landing page, no viral loop | B2, B1 |

---

## Locked Decisions

1. **Publish v0.2.1 to npm immediately** (7/7 SUPPORT) — Fix the web crash first, then ship. Every day of delay compounds user loss.

2. **Fix `clens web` crash on npm install** (7/7 SUPPORT) — The `@clens/cli/src/*` import paths are not in the npm `files` array. Either add a try/catch with clear error, bundle web assets, or fix the import paths. Prerequisite for #1.

3. **Fix first-run experience and README correctness** (7/7 SUPPORT) — Fix the package name in README. Add post-init guidance. Improve empty states. Sub-hour fixes with outsized conversion impact.

4. **Auto-distill on demand** (7/7 SUPPORT) — When `clens what`, `clens web` session view, or Insights page encounters undistilled data, auto-run distill with a status indicator. Remove all "run command X first" error messages.

5. **Fix data integrity bugs** (7/7 SUPPORT) — Extract `persistDistillResult` helper called from both CLI and web distill paths. Fix analytics-summary cache invalidation. Move duplicate analytics types to shared.

6. **Define and lock web dashboard MVP scope** (7/7 SUPPORT) — Write a one-page MVP: session list, session detail, basic usage. Lock it. No new web features until the MVP ships and gets user feedback. Archive superseded specs.

7. **Make the analytical moat visible — public launch** (7/7 SUPPORT) — Produce a killer screenshot of backtrack/edit-chain analysis. Add competitive comparison table to README. Post on HN/Reddit. Execute only after #1-3 are complete.

8. **Wire 3 hero features into web UI** (AMENDED, 5/7 AMEND) — Scope to backtracks, edit chains, and agent tree only. Execute after v0.2.1 is published and `clens web` works. Make these the demo-worthy features.

9. **Validate/calibrate core extractors** (5/7 SUPPORT) — Add golden-session tests for the 5 most-cited extractors (backtracks, decisions, timeline, edit chains, plan drift). Verify accuracy before using them in marketing claims.

---

## Killed Proposals

| Proposal | Why | Vote |
|---|---|---|
| OTel export (BALLOT-9) | Premature — addresses enterprise users who don't exist yet. Fix the 0-user problem first. Defer to v0.3.0. | 5 OPPOSE, 2 AMEND |
| Kill the TUI (BALLOT-10) | TUI is a differentiator for terminal-native users. Freeze development, don't delete. | 6 OPPOSE, 1 SUPPORT |
| Node.js support (BALLOT-13) | Significant engineering cost for a hypothetical user. The bottleneck is visibility and quality, not runtime. Revisit when demand exists. | 4 OPPOSE, 1 AMEND, 2 SUPPORT |

---

## Deferred (not enough votes)

| Proposal | Why | Resolution |
|---|---|---|
| Rename "decisions" to "friction points" (BALLOT-11) | 4 SUPPORT vs 3 OPPOSE. Valid concern about misleading labels, but breaking change risk and low priority vs publish. | Defer to v0.3.0 with schema migration path |

---

## Unresolved Tensions (require human judgment)

### Tension 1: Web scope — freeze vs scope-lock vs continue

- **A5 (Anarchist):** Feature-freeze the web entirely until 10 users give feedback.
- **B1 (Scout), B2 (Strategist):** The web UI is the growth surface — it needs to ship, not freeze.
- **A3 (Auditor):** Define MVP, ship what exists, stop adding.
- **Adopted resolution:** Lock MVP scope (Decision #6). Not a full freeze, but a hard stop on new features until the MVP ships and gets feedback. This was the majority position.

### Tension 2: Bun-only runtime

- **A5, B1, B2:** Bun-only limits the addressable market.
- **A1, A2, A3:** Not the bottleneck at this stage — visibility and quality matter more.
- **A4:** Ship pre-compiled binary as alternative.
- **Adopted resolution:** Killed as a near-term task (BALLOT-13). Revisit when npm installs reach 1,000/week or when a specific user reports the barrier.

### Tension 3: Extractor quality vs quantity

- **A4 (Philosopher):** 23 extractors is a liability if unvalidated. Need 3 good ones, not 23 unproven ones.
- **B1 (Scout):** The 23 extractors are the moat — make them visible, not fewer.
- **Adopted resolution:** Validate the top 5 (Decision #9) and surface 3 "signature metrics" prominently. Keep all 23 but don't market the count — market the insight quality.

---

## Recommended Path Forward

Based on the panel's locked decisions, the work sequences into three gates:

### Gate 1: Ship (estimated 1-2 days)
1. Fix `clens web` import crash (BALLOT-8) — fix source path imports or add graceful error
2. Fix README package name (`@silou/clens`) and update stale badge numbers
3. Delete `SessionSnapshot.tsx` dead file, fix `formatTokenCount` bug
4. Run `bun run typecheck && bun test && bun run build`
5. Publish v0.2.1 to npm

### Gate 2: Fix (estimated 2-3 days)
6. Implement auto-distill on demand for `clens what`, web session detail, and Insights
7. Extract `persistDistillResult` helper — fix analytics-summary gap
8. Add first-run guidance: post-init banner, improved empty states
9. Write web dashboard MVP scope document — lock it

### Gate 3: Grow (estimated 3-5 days)
10. Wire backtracks, edit chains, and agent tree into web UI as hero features
11. Add golden-session tests for top 5 extractors
12. Produce README screenshot + competitive comparison table
13. Prepare and execute "Show HN" launch post

**Total estimated effort: 6-10 days of focused work.**

Nothing in Gate 2 should start before Gate 1 ships. Nothing in Gate 3 should start before Gate 2 is complete. The sequential discipline is essential — launching with a broken install or empty first-run converts a growth opportunity into negative word-of-mouth.

---

## Raw Deliberation Log

- Wave 1 reports: `deliberation/wave1/`
  - `a1_structural_engineer.md`
  - `a2_human_psychologist.md`
  - `a3_realist_auditor.md`
  - `a4_philosopher.md`
  - `a5_anarchist.md`
  - `b1_scout.md`
  - `b2_strategist.md`
- Wave 1 ballot: `deliberation/wave1_ballot.md`
- Wave 2 votes: `deliberation/wave2/`
  - `a1_votes.md` through `b2_votes.md`
- Wave 2 tally: `deliberation/wave2_tally.md`
- This brief: `deliberation/final_brief.md`
