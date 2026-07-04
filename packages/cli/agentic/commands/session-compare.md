---
description: Compare two distilled clens sessions side-by-side to identify performance differences
argument-hint: "<session-1> <session-2>"
---

# Session Compare Command

Compare two distilled clens sessions side-by-side to identify performance differences and determine which approach was more effective.

## Setup

Load the `session-analysis` skill for schema knowledge and interpretation context before proceeding.

## Variables

TARGET: $ARGUMENTS

## Workflow

### 1. Resolve Both Sessions

- If TARGET contains two session IDs (space-separated), use those
- If TARGET is `--last 2` or `--last`, find the two most recent distilled sessions in `.clens/distilled/`
- If TARGET contains only one session ID, use it as Session A and the most recent other session as Session B
- If fewer than 2 distilled sessions exist, inform the user:
  > Need at least 2 distilled sessions to compare. Run `clens distill` on more sessions first.

Label the older session as **Session A** and the newer as **Session B**.

### 2. Gather Data for Both Sessions

Read both distilled JSON files from `.clens/distilled/{sessionId}.json` for the full `DistilledSession` objects. Each contains all extracted data: `stats`, `backtracks`, `decisions`, `file_map`, `git_diff`, `edit_chains`, `reasoning`, `user_messages`, `summary`, `timeline`, `agents`, `team_metrics`, `communication_graph`, `plan_drift`, and `cost_estimate`.

No CLI commands are needed — the distilled JSON files are the primary data source.

### 3. Compute Metrics Comparison

Build a comparison table with deltas for:

| Metric | How to Compare |
|--------|---------------|
| Duration | Shorter is better |
| Tool calls | Fewer is generally better |
| Failures | Fewer is better |
| Failure rate | Lower is better |
| Estimated cost | Lower is better |
| Backtracks | Fewer is better |
| Files touched | Context-dependent |
| Files modified | Context-dependent |
| Thinking blocks | Context-dependent |

Use arrows or indicators to mark which session performed better on each metric.

### 4. Compare Backtracks

Break down backtracks by type for both sessions:

- `failure_retry` count in A vs B
- `iteration_struggle` count in A vs B
- `debugging_loop` count in A vs B

Analyze which session had cleaner execution and whether backtracks targeted the same files.

### 5. Analyze Tool Usage Shift

Union all tools from both sessions and compute:

- Count per tool in each session
- Delta between sessions
- Tools present in only one session (added/removed)
- Sort by absolute delta descending

Interpret what the tool usage shift reveals about approach differences.

### 6. Compare Phases

List each phase from both sessions with name, duration, and top tools. Analyze:

- Did one session have a cleaner progression?
- Did one spend more time in exploration vs modification?
- Did one have a debugging phase the other did not?

### 7. File Overlap Analysis

Find files appearing in both sessions' `file_map.files`:

- Show read and edit counts per session for overlapping files
- Count files unique to each session
- List top 3 unique files per session

### 8. Generate Verdict

Provide a clear verdict:

1. Which session was more efficient and why (primary, secondary, tertiary reasons)
2. What to keep from the better session (specific patterns or approaches)
3. What to improve from the worse session (specific patterns to change)
4. Recommendations for future sessions (1-3 actionable suggestions)

## Notes

- Comparisons are most meaningful between sessions working on similar tasks
- Model differences can dominate metrics -- control for model when possible
- Delta values use absolute difference; percentage changes are relative to Session A
