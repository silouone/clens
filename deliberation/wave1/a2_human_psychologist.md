## Agent A2 — Human Psychologist: Wave 1 Analysis

### Key Findings

**[FATAL] The first-run experience is a cliff, not a ramp**

The README opens with `npm install -g clens` then lists commands. `clens list` on an empty project produces a table with no rows. `clens what --last` throws if distill hasn't been run. Nothing explains the pipeline (run session -> distill -> look). The tired, first-time user installs, runs `clens list`, sees nothing, assumes it doesn't work, closes the terminal, never comes back.

- Alternative: Add a `clens init --status` check and post-init banner with the three-step flow.

**[SERIOUS] `distill` is a manual step no one will remember to run**

Every interesting command requires distilled data. Distillation is not automatic. Users must remember `clens distill --last` before `clens what --last`. Every time. By week 6 they won't bother.

- Alternative: Auto-run distill inline when distilled data is absent, with `--no-distill` escape hatch.

**[SERIOUS] The web dashboard lives on `clens-web` branch and is not shipped**

v0.2.1 has not been published. The 196 downloads all get the pre-web version.

- Alternative: Publish v0.2.1 and decide on web dashboard distribution strategy.

**[SERIOUS] The Insights page requires "Rebuild Analytics" as a manual step**

Empty state with a "Rebuild Analytics" button and weak copy. Users who just distilled sessions and navigate to Insights see an empty state and assume the feature is broken.

- Alternative: Auto-trigger analytics build on first visit when distilled sessions exist.

**[MODERATE] Navigation is too flat for power users and too complex for new users**

"Work Units" is jargon with no tooltip. Analytics dropdown is hover-triggered (fails on touch).

- Alternative: Rename "Work Units" to "Projects" with tooltip, make Analytics click-triggered.

**[MODERATE] BottomPanel with backtracks/timeline/edit chains starts collapsed**

The highest-value analysis is invisible on first visit. 10px toggle text.

- Alternative: Auto-expand BottomPanel when backtrack count > 0, add count badge.

**[MODERATE] TUI `tui.ts` is 1,553 LOC — contributor deterrence**

- Alternative: Execute `specs/split-tui-into-modules.md`.

### Proposals

1. First-Run Experience Hardening — fix empty states, auto-distill, post-init banner
2. Publish v0.2.1 and Ship the Web Dashboard
3. Auto-Pipeline — Remove All Manual Trigger Steps

### Priority Ranking

1. First-Run Experience (highest immediate impact on retention)
2. Publish v0.2.1 + Web Dashboard Distribution
3. Auto-Pipeline — Remove Manual Trigger Steps
