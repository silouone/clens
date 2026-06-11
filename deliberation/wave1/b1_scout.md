## Agent B1 — Scout: Wave 1 Analysis

### Key Findings

**[FATAL] The competitive moat cLens claims does not survive contact with new entrants**

Multiple direct competitors have arrived with overlapping coverage:
- **simple10/agents-observe** (285 stars, v0.7.4, Apr 1 2026): Hook-based, live React 19 dashboard, SQLite, WebSocket. Direct architectural twin.
- **ccboard/ccboard** (45 stars, 346 commits): Rust TUI + web, 13 tabs, cross-editor, budgeting, anomaly detection.
- **JayantDevkar/claude-code-karma** (150 stars): FastAPI + SvelteKit, zero-config, reads ~/.claude/ natively.
- **ColeMurray/claude-code-otel** (332 stars): OTel export to Grafana/Datadog.
- **eunomia-bpf/agentsight** (270 stars): eBPF zero-instrument, works with any agent.

cLens has 3 GitHub stars. The moat (23 extractors with unique depth) is entirely undiscoverable.

**[SERIOUS] Live Mode is 95% ready but not shipped**

The spec says infrastructure is ready. SSE exists. Meanwhile agents-observe ships live WebSocket updates. ccboard ships live monitoring. The competitive advantage evaporates without live mode.

- Alternative: Execute the builder spec. Bundle context consumption chart.

**[SERIOUS] GitHub presence is effectively zero — 3 stars**

`agents-observe` has 285 stars and is 4 days younger in feature completeness. This is a distribution problem, not a quality problem.

- Alternative: Publish, launch on HN/Reddit/Twitter, add screenshots to README, claim topic tags.

**[SERIOUS] Context Consumption is implemented but not integrated**

Nearly complete feature sitting untracked. Partially shipped is worse than not started.

- Alternative: Wire into distill/index.ts, test, merge, publish.

**[MODERATE] No differentiation against OTel export and eBPF approaches**

No export path, no standard telemetry story. Enterprise users can't send data to existing Grafana.

- Alternative: Add `clens export --otel` as stretch goal in v0.3.

**[MODERATE] Web dashboard nav spec (Mission Control v3) written but not executed**

Code and spec are diverging.

### Competitive Landscape Update

| Tool | Stars | Architecture | Overlap |
|---|---|---|---|
| disler/hooks-observability | 1,300 | Python+SQLite+Vue | High |
| simple10/agents-observe | 285 | Node+Hono+SQLite+React19 | Very High |
| ColeMurray/claude-code-otel | 332 | OTel export | Medium |
| ccboard/ccboard | 45 | Rust binary | High |
| claude-code-karma | 150 | Python+SvelteKit | High |
| agentsight | 270 | Rust+eBPF | Low |
| claude-code-history-viewer | ~517 | Tauri+Rust+React | Low |
| @silou/clens | 3 | TypeScript+Bun | — |

### Proposals

1. Finish Live Mode + Merge + Publish v0.2.1
2. Public launch / distribution push (HN, Reddit, Twitter, screenshots)
3. Work Unit Detail Page (atomic design system extraction)

### Priority Ranking

1. Finish Live Mode + Merge + Publish v0.2.1
2. Public launch / distribution push
3. Work Unit Detail Page
