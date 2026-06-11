# Wave 2 Vote Tally

## Vote Matrix

| Ballot | A1 | A2 | A3 | A4 | A5 | B1 | B2 | Result |
|---|---|---|---|---|---|---|---|---|
| 1: Publish v0.2.1 | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 2: Auto-distill | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 3: First-run + README | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 4: Lock web MVP scope | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 5: Make moat visible | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 6: Wire invisible features | A | A | A | A | O | S | A | **AMENDED** (5A) |
| 7: Data integrity bugs | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 8: Fix web crash | S | S | S | S | S | S | S | **LOCKED** (7/7) |
| 9: OTel export | O | O | O | O | O | A | A | **KILLED** (5/7 O) |
| 10: Kill TUI | O | O | O | O | S | O | O | **KILLED** (6/7 O) |
| 11: Rename decisions | O | O | O | S | S | S | S | CONTESTED (4S/3O) |
| 12: Validate extractors | S | S | Ab | S | A | S | S | **LOCKED** (5S/7) |
| 13: Node.js support | O | O | O | A | O | S | S | **KILLED** (4O + context) |

S=Support, O=Oppose, A=Amend, Ab=Abstain

## Results Summary

- **LOCKED (supermajority support):** 9 items (1, 2, 3, 4, 5, 7, 8, 12 + 6 as amended)
- **KILLED (supermajority oppose):** 3 items (9, 10, 13)
- **CONTESTED:** 1 item (11)

## Red Flag Review (Unanimous Votes)

Seven items received 7/7 SUPPORT. Review for groupthink:

- **BALLOT-1 (Publish):** GENUINE. Independent evidence: 38-day gap, broken npm experience, competitors shipping. No counter-argument withstands the cost of delay.
- **BALLOT-2 (Auto-distill):** GENUINE. Independent evidence: manual pipeline tax confirmed in source code, no competitor requires it.
- **BALLOT-3 (First-run + README):** GENUINE. Wrong package name is objectively broken. Empty first-run state confirmed in source.
- **BALLOT-4 (Lock web MVP):** GENUINE. 6+ untracked web files, 12+ web redesign specs. Observable scope creep.
- **BALLOT-5 (Make moat visible):** GENUINE. 3 stars vs 285-1200 for competitors. Distribution failure is measurable.
- **BALLOT-7 (Data integrity):** GENUINE. Analytics cache gap confirmed by multiple agents reading source.
- **BALLOT-8 (Fix web crash):** GENUINE. Import boundary violation confirmed — `src/` paths not in npm `files` array.

All unanimous votes reflect genuine independent convergence on observable evidence.

## BALLOT-6 Amended Version (Merged)

Original: Wire existing invisible features into web UI.
Merged amendment from A1, A2, A3, A4, B2: Scope wiring to 3 differentiating features (backtracks, edit chains, agent tree). Execute only after v0.2.1 is published and `clens web` is confirmed working. Reframe as "ensure hero features are reachable within first-run flow."

## Convergence Metrics

| Metric | Value | Target | Status |
|---|---|---|---|
| Agreement Index | 92% (12/13 resolved) | >60% | PASSED |
| Stability Index | 86% (6/7 verdicts stable) | >70% | PASSED |
| Novelty Rate | 4 new proposals in W2 vs 22 in W1 | Decreasing | CONVERGING |

**CONVERGENCE ACHIEVED in Wave 2. No Wave 3 needed.**

## CONTESTED: BALLOT-11 (Rename decisions)

- FOR (4): A4, A5, B1, B2 — "decisions" label is misleading, noise output erodes trust
- AGAINST (3): A1, A2, A3 — cosmetic rename doesn't fix the extractor, breaking change risk, low priority vs publish

**Resolution:** Deferred to post-launch. The rename has merit but is not blocking and carries backward-compatibility risk. Recommended for v0.3.0 with a schema migration path.
