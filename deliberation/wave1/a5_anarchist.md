## Agent A5 — Anarchist: Wave 1 Analysis

### Key Findings

**[FATAL] The web dashboard is accumulating design debt faster than it is acquiring users**

85+ specs, 12+ web-specific redesign/overhaul documents. UI/UX audit rated attractiveness at 5.25/10. At minimum 3 distinct navigation structures planned simultaneously. 196 total npm downloads, no evidence of a second user other than the author. Each new spec resets the previous spec's investment without shipping.

- Alternative: Feature-freeze web. Ship v0.2.1 CLI-only. No new web features until 10 distinct users have filed feedback.

**[SERIOUS] Bun-only runtime is a silent adoption killer**

No Node.js runtime path. Any developer on Windows or managed systems without Bun cannot use cLens. Bun adoption outside narrow TypeScript-native audience is minimal. Competing Python tool (1,200 stars) runs everywhere.

- Alternative: Add Node.js build target for CLI binary. Hook path only needs `fs`, `path`, `process`.

**[SERIOUS] 85+ spec files represent a planning-to-shipping ratio that is dangerously inverted**

Many specs superseded by later specs without closure. `journey-layer-v1.md` and `journey-layer-implementation.md` coexist. `clens-web-v2.md` -> `web-redesign-v2.md` -> `web-overhaul-r2.md` -> `web-mission-control-v3.md`. This is planning about planning.

- Alternative: Archive specs older than 30 days. Ban new specs until current changes ship. One active spec at a time.

**[MODERATE] CLI command surface is wider than user base can discover or retain**

11 commands with multiple subcommands. TUI is 1,553 LOC with 9 tabs. 23 extractors. For 196 downloads, this is over-engineered.

- Alternative: Focus on 3 commands (`init`, `what --last`, `web`). Cut TUI entirely.

**[MODERATE] Analytics pipeline has duplicate type definitions that will diverge**

`analytics.ts` and `analytics-store.ts` both independently define matching interfaces not in shared types.

- Alternative: Move analytics types to `shared/types.ts`.

**[MODERATE] `SessionSnapshot.tsx` is a dead stub**

Empty re-export with no surviving imports.

- Alternative: Delete it.

**[MINOR] Distill pipeline I/O leak documented but unfixed**

`existsSync + readFileSync` in distill layer violates "pure extractors" claim.

- Alternative: Pass spec file content as string parameter. 45 minutes.

### Proposals

1. Publish v0.2.1 immediately — stop adding features until publication
2. Freeze web package, invest in CLI discoverability
3. Kill the TUI (`clens explore`) entirely — redirect to web dashboard

### Priority Ranking

1. Publish v0.2.1 now
2. Fix analytics type duplication + delete SessionSnapshot.tsx
3. Kill the TUI
