---
description: Analyze a distilled clens session and generate a structured performance report
argument-hint: "[session-id or --last]"
---

# Session Report Command

Generate a structured performance report for a distilled clens session. Reads the distilled JSON directly for a single comprehensive analysis.

## Setup

Load the `session-analysis` skill for schema knowledge and interpretation context before proceeding.

## Variables

TARGET: $ARGUMENTS

## Workflow

### 1. Resolve the Session

- If TARGET is empty or `--last`, find the most recent distilled session in `.clens/distilled/`
- If TARGET is a session ID (full UUID or prefix), find `.clens/distilled/{TARGET}*.json`
- If no distilled file is found, inform the user:
  > No distilled session found. Run `clens distill --last` first, then re-run this command.

### 2. Gather Data

Read the distilled JSON file at `.clens/distilled/{sessionId}.json` for the complete `DistilledSession` object. This single file contains all extracted data: `stats`, `backtracks`, `decisions`, `file_map`, `git_diff`, `edit_chains`, `reasoning`, `user_messages`, `summary`, `timeline`, `agents`, `team_metrics`, `communication_graph`, `plan_drift`, and `cost_estimate`.

No CLI commands are needed — the distilled JSON is the primary data source.

### 3. Build Overview Table

Extract key metrics into a summary table:

| Metric | Source Field |
|--------|-------------|
| Duration | `summary.key_metrics.duration_human` |
| Model | `stats.model` |
| Tool calls | `stats.tool_call_count` |
| Failures | `stats.failure_count` (with failure rate as percentage) |
| Files touched | `stats.unique_files.length` |
| Files modified | `summary.key_metrics.files_modified` |
| Estimated cost | `stats.cost_estimate.estimated_cost_usd` |
| Backtracks | `backtracks.length` |
| Thinking blocks | `reasoning.length` |

### 4. Calculate Efficiency Score

Compute a weighted score from 1-10:

- **Failure rate** (weight 3): 10 if <5%, 7 if 5-15%, 4 if 15-30%, 1 if >30%
- **Backtrack density** (weight 3): 10 if 0, 8 if 1-2, 5 if 3-4, 2 if 5+
- **Cost efficiency** (weight 2): 10 if cost/file < $0.50, 7 if < $1.00, 4 if < $2.00, 1 if > $2.00
- **Phase coherence** (weight 2): 10 if clear progression, 5 if some back-and-forth, 2 if chaotic

Present the weighted average rounded to nearest integer with a one-sentence justification.

### 5. Analyze Tool Usage

From `stats.tools_by_name`, build a table sorted by count descending:

- Tool name, count, percentage of total tool calls
- Highlight tools with high failure rates

### 6. Analyze Backtracks

If backtracks exist, for each one summarize:

- Type, tool name, file path
- Attempt count, duration
- Error message
- Brief interpretation based on backtrack type

If no backtracks: report clean execution.

### 7. Summarize Decision Points

From the `decisions` array, categorize and summarize:

- **Timing gaps**: Count, durations, classifications
- **Tool pivots**: From/to tools, whether healthy or concerning
- **Phase boundaries**: List phase transitions

### 8. Phase Breakdown

Build a table from `summary.phases`:

- Phase index, name, duration (`end_t - start_t` formatted), tools (`tool_types` array, already sorted by frequency), description

### 9. File Activity

List top 10 files from `file_map.files` sorted by total activity:

- File path (truncated to last 2 segments if long), read count, edit count, write count, error count

### 10. Git Changes Summary

From `git_diff`:

- Commit count, total additions, total deletions
- Note any uncommitted working tree changes

### 11. Generate Recommendations

Based on detected patterns, provide 2-5 actionable recommendations:

- High failure rate (>15%): Suggest reducing tool failures with specific tool guidance
- Many backtracks (>3): Suggest clarifying requirements for problematic files
- High cost per file (>$1.00): Suggest model optimization for specific phases
- Iteration struggles: Address fragile files with explicit edit instructions
- Debugging loops: Improve environment setup by documenting working commands
- High read-to-edit ratio: Reduce exploration overhead with more specific file paths

## Report Structure

The final report should follow this section order:

1. Overview (metrics table)
2. Narrative (`summary.narrative`)
3. Efficiency Score
4. Tool Usage
5. Backtracks (omit if empty)
6. Decision Points
7. Phase Breakdown
8. File Activity (top 10)
9. Git Changes
10. Recommendations

Omit sections that have no data (e.g., skip Backtracks if array is empty, skip Git Changes if no git diff data).

## Notes

- This report synthesizes data from the distilled session, not raw events
- Cost estimates are heuristic-based with approximately 20% margin of error
- Efficiency scores are relative guidelines, not absolute measures
- Recommendations are pattern-based suggestions, not definitive diagnoses
