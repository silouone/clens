## Agent A4 — Philosopher: Wave 1 Analysis

### Key Findings

**[SERIOUS] The "observability" metaphor is borrowed but the feedback loop it implies does not exist**

"Observability" implies real-time or near-real-time understanding. cLens delivers post-hoc forensics via explicit `distill` command. The mental model being sold is observability but what the system delivers is forensics. Calling it observability creates confusion about what users should expect. The core loop is: run session -> remember to distill -> remember to look. That is closer to `git log` than to Datadog.

**[SERIOUS] 23 extractors is not a moat — it is a liability disguised as depth**

The extractor count is used as a quality signal when it is a quantity signal. A user with 196 npm downloads does not need 23 extractors. They need 3 extractors that reliably answer questions they actually have: "What did this session do?" (what), "Did it struggle?" (backtracks), "What did it cost?" (cost). Everything else assumes a workflow (spec-driven multi-agent orchestration) that most users do not have.

**[SERIOUS] The `decisions` extractor produces noise, not decisions**

"Decision points" are actually timing gaps (pauses), tool pivots (error recovery), and phase boundaries (5-minute gaps). These are structural artifacts of the event stream, not semantic decisions. The type name `DecisionPoint` implies semantic content it does not have. Users cannot act on "the agent was thinking for 45 seconds."

- Alternative: Rename to `FrictionPoint` or `EffortSignal`, rewrite documentation.

**[MODERATE] Plan drift is conceptually sound but mechanically broken for most users**

Only works when user invokes `/build specs/X.md` with filenames in recognizable patterns. Covers one narrow workflow pattern matching the author's workflow.

**[MODERATE] Context consumption tracking is architecturally incomplete**

Returns undefined for unknown models. Velocity post-compaction is meaningless. Live context bar disconnected from extractor.

**[MODERATE] The web dashboard and CLI are architecturally drifting apart**

Two separate data models (analytics-summary.jsonl vs raw JSONL) that must stay in sync. JSONL with string-based keying is not a proper data layer.

**[MINOR] The `work-units` concept is underspecified**

Cross-session linking relies on assumptions (spec files, non-main branches, 3-hour temporal gap) with no user validation.

### Proposals

1. Collapse distill-then-analyze into single `clens what --last` with auto-distill
2. Rename "decisions" to "friction points" — conceptual clarification
3. Validate core 3 extractors against real sessions before adding more

### Priority Ranking

1. Auto-distill-on-demand for `clens what`
2. Calibrate and reframe decisions/friction extractor
3. Validate plan-drift against real sessions
