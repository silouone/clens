---
description: "Analyze cross-session development lifecycle and generate a journey report"
argument-hint: "[journey-id or --last]"
---

# Journey Report

Generate a structured lifecycle report for a cross-session development journey.

## Variables

TARGET: $ARGUMENTS

## Instructions

### 1. Resolve the Journey

Journey data is built by reading and chaining distilled sessions. There is no standalone `clens journey` command — journey analysis is done by reading distilled session files directly.

1. List all distilled sessions: `ls .clens/distilled/*.json` (sorted by modification time)
2. Read each distilled JSON to extract: `session_id`, `start_time`, `stats`, `summary`, `user_messages`, `plan_drift`
3. Chain sessions into a journey:
   - Sessions sharing the same working directory and started within 5 seconds of a `/clear` or compact event belong to the same journey
   - Order phases chronologically by `start_time`
4. If TARGET is a session ID prefix, find the journey containing that session
5. If TARGET is empty or `--last`, use the most recent journey (by latest session start time)

If fewer than 1 distilled session exists, tell the user:
> No distilled sessions found. Run `clens distill --last` to distill your sessions first.

### 2. Build the Journey

- Load the `session-analysis` skill for schema and interpretation context
- For each session in the journey, classify its phase type from the first user prompt:
  - `/prime` → `prime`, `/brainstorm` → `brainstorm`, `/plan` or `/plan_w_team` → `plan`, `/build` → `build`, `/review` → `review`, `/test` → `test`
  - "commit" keyword → `commit`
  - High read:write ratio (>3:1) → `exploration`
  - >3 TaskCreate calls (4+) → `orchestrated_build`
  - <30s and <15 events → `abort`
  - Default → `freeform`
- Determine `lifecycle_type` from the set of phase types present:
  - Has prime + plan + build → `prime-plan-build`
  - Has prime + build (no plan) → `prime-build`
  - Has build (no prime) → `build-only`
  - Single session → `single-session`
  - Otherwise → `ad-hoc`
- Compute cumulative stats by summing across all sessions
- Key fields to present: `id`, `lifecycle_type`, `phases`, `transitions`, `cumulative_stats`, `plan_drift`, `spec_ref`

### 3. Generate the Report

Use the following template. Replace all placeholders with actual data. Omit sections that have no data (e.g., skip Plan Drift section if `plan_drift` is absent, skip Transitions if array is empty).

---

## Journey Report: {id}

### Overview

| Metric | Value |
|--------|-------|
| Lifecycle | {lifecycle_type} |
| Phases | {phases.length} |
| Total duration | {cumulative_stats.total_duration_ms formatted as human-readable} |
| Total events | {cumulative_stats.total_events} |
| Total tool calls | {cumulative_stats.total_tool_calls} |
| Total failures | {cumulative_stats.total_failures} |
| Retries (aborted phases) | {cumulative_stats.retry_count} |
| Spec reference | {spec_ref or "none"} |

### Phases

| # | Type | Source | Duration | Events | Session | Spec |
|---|------|--------|----------|--------|---------|------|
{For each phase in phases: index (1-based), phase_type, source, duration_ms formatted, event_count, session_id (first 8 chars), spec_ref or "-"}

### Phase Interpretation

For each phase, provide a one-line interpretation based on phase_type:
- `prime` -- Context priming, loading project knowledge
- `brainstorm` -- Ideation and design exploration
- `plan` -- Structured planning, spec creation
- `build` -- Implementation, code writing
- `review` -- Code review, quality checks
- `test` -- Test writing or execution
- `commit` -- Commit creation, git operations
- `exploration` -- Read-heavy exploration (read:write ratio > 3:1)
- `orchestrated_build` -- Multi-agent coordinated build (>3 TaskCreate, i.e., 4+)
- `freeform` -- General-purpose session, no dominant pattern
- `abort` -- Short session (<30s, <15 events), likely abandoned

### Transitions ({transitions.length})

If transitions is empty: "Single-session journey -- no transitions."

If transitions exist:

| From | To | Trigger | Gap | Git Changed | Prompt Shift |
|------|----|---------|-----|-------------|--------------|
{For each transition: from_session (8 chars), to_session (8 chars), trigger, gap_ms formatted, git_changed (yes/no), prompt_shift (truncated to 60 chars)}

**Transition trigger types:**
- `clear` -- User ran `/clear` to start fresh context
- `compact_auto` -- Context compaction (manual or automatic). Currently all compact sources produce this value
- `compact_manual` -- Reserved for future use. Not currently produced by the code

### Cumulative Stats

| Metric | Value |
|--------|-------|
| Total duration | {cumulative_stats.total_duration_ms formatted} |
| Total events | {cumulative_stats.total_events} |
| Tool calls | {cumulative_stats.total_tool_calls} |
| Failures | {cumulative_stats.total_failures} ({failure rate as %}%) |
| Phase count | {cumulative_stats.phase_count} |
| Retry count | {cumulative_stats.retry_count} |

### Plan Drift Assessment

If `plan_drift` is absent: "No spec reference found -- plan drift not applicable."

If `plan_drift` is present:

**Spec:** {plan_drift.spec_path}
**Drift score:** {plan_drift.drift_score} (0.0 = perfect alignment, 1.0 = complete divergence)

| Category | Count | Files |
|----------|-------|-------|
| Expected | {plan_drift.expected_files.length} | {first 5 files, truncated paths} |
| Actual | {plan_drift.actual_files.length} | {first 5 files} |
| Unexpected | {plan_drift.unexpected_files.length} | {list all} |
| Missing | {plan_drift.missing_files.length} | {list all} |

**Drift interpretation:**
- Score < 0.3: Good alignment -- implementation follows the spec closely
- Score 0.3-0.7: Moderate drift -- some divergence from the original plan
- Score > 0.7: High drift -- significant departure from spec, may indicate scope change or plan revision

### Lifecycle Assessment

Based on the `lifecycle_type`, provide a brief assessment:

- `prime-plan-build` -- Full lifecycle: context was primed, a plan was created, then implementation followed. This is the most structured workflow.
- `prime-build` -- Primed then built directly. Efficient for well-understood tasks.
- `build-only` -- Jumped straight to implementation. Works for small, clear tasks.
- `single-session` -- Completed in one session. Either a small task or a session that was not chained.
- `ad-hoc` -- No clear lifecycle pattern. May indicate exploratory or reactive work.

### Recommendations

Based on the data, provide 2-5 actionable recommendations:

- If `retry_count > 0`: "**Reduce aborted phases** -- {retry_count} phase(s) were aborted. Consider clearer prompts or better context before starting."
- If `lifecycle_type === "ad-hoc"` and phases > 2: "**Adopt structured workflow** -- Multiple phases without clear lifecycle progression. Consider using /prime -> /plan -> /build flow."
- If `plan_drift` exists and `drift_score > 0.5`: "**Address plan drift** -- {missing_files.length} expected files missing, {unexpected_files.length} unexpected files created. Revisit the spec or update it to match actual work."
- If any transition has `gap_ms > 3600000` (1 hour): "**Long gaps detected** -- Consider documenting context before breaks to reduce ramp-up time."
- If `cumulative_stats.total_failures / total_tool_calls > 0.15`: "**High failure rate** -- {percentage}% of tool calls failed across the journey. Review common failure patterns."
- If phases contain both `exploration` and `build`: "**Separate exploration from building** -- Consider completing exploration in a dedicated session before starting implementation."

---

## Notes

- Journeys are constructed by chaining sessions that share the same working directory and were started via clear/compact within 5 seconds
- Phase types are classified from the first user prompt and tool usage patterns
- Plan drift requires a spec reference in a /build phase and distilled file maps
- Lifecycle classification is heuristic-based and reflects the dominant workflow pattern
