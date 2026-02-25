---
description: "Analyze a distilled clens session and generate a structured performance report"
argument-hint: "[session-id or --last]"
---

# Session Report

Generate a structured performance report for a distilled clens session.

## Variables

TARGET: $ARGUMENTS

## Instructions

### 1. Resolve the Session

- If TARGET is empty or `--last`, find the most recent distilled session:
  - List files in `.clens/distilled/` sorted by modification time
  - Use the most recently modified `.json` file
- If TARGET is a session ID (full UUID or prefix), find `.clens/distilled/{TARGET}*.json`
- If no distilled file is found, tell the user:
  > No distilled session found. Run `clens distill --last` to distill your most recent session, then re-run this command.

### 2. Read the Data

- Read the distilled JSON file at `.clens/distilled/{sessionId}.json`
- Parse the full `DistilledSession` object
- Load the `session-analysis` skill for schema and interpretation context

### 3. Generate the Report

Use the following template. Replace all placeholders with actual data. Omit sections that have no data (e.g., skip Backtracks section if array is empty, skip Agents section if not a multi-agent session).

---

## Session Report: {session_id first 8 chars}

### Overview

| Metric | Value |
|--------|-------|
| Duration | {summary.key_metrics.duration_human} |
| Model | {stats.model or "unknown"} |
| Tool calls | {stats.tool_call_count} |
| Failures | {stats.failure_count} ({failure_rate as percentage}%) |
| Files touched | {stats.unique_files.length} |
| Files modified | {summary.key_metrics.files_modified} |
| Estimated cost | ${stats.cost_estimate.estimated_cost_usd} |
| Backtracks | {backtracks.length} |
| Thinking blocks | {reasoning.length} |

### Narrative

{summary.narrative}

### Efficiency Score

Calculate a score from 1-10 based on these weighted factors:
- **Failure rate** (weight 3): 10 if <5%, 7 if 5-15%, 4 if 15-30%, 1 if >30%
- **Backtrack density** (weight 3): 10 if 0, 8 if 1-2, 5 if 3-4, 2 if 5+
- **Cost efficiency** (weight 2): 10 if cost/file < $0.50, 7 if < $1.00, 4 if < $2.00, 1 if > $2.00
- **Phase coherence** (weight 2): 10 if clear progression, 5 if some back-and-forth, 2 if chaotic

Compute the weighted average and round to nearest integer. Present as:

**Efficiency: {score}/10** -- {one sentence justification}

### Tool Usage

| Tool | Count | % of Total |
|------|-------|------------|
{For each tool in stats.tools_by_name, sorted by count descending, show name, count, and percentage}

### Backtracks ({backtracks.length})

If backtracks is empty: "No backtracks detected -- clean execution."

If backtracks exist, for each one:

**{index}. {type}** on `{tool_name}` {file_path if present}
- Attempts: {attempts}
- Duration: {end_t - start_t} ms
- Error: {error_message or "N/A"}
- {Brief interpretation based on backtrack type -- see interpretation guide}

### Decision Points ({decisions.length})

Summarize notable decisions:

**Timing gaps:** {count} detected
- {For each timing_gap: duration, classification, brief interpretation}

**Tool pivots:** {count} detected
- {For each tool_pivot: from_tool -> to_tool, whether healthy or concerning}

**Phase boundaries:** {count} detected
- {List phase transitions}

### Phase Breakdown

| # | Phase | Duration | Tools | Description |
|---|-------|----------|-------|-------------|
{For each phase in summary.phases: index, name, duration (end_t - start_t formatted), tool_types (already sorted by frequency), description}

### File Activity (top 10)

| File | Reads | Edits | Writes | Errors |
|------|-------|-------|--------|--------|
{Top 10 files from file_map.files, sorted by activity. Truncate long paths to last 2 segments}

### Git Changes

- Commits: {git_diff.commits.length}
- Total additions: {sum of hunks additions}
- Total deletions: {sum of hunks deletions}
{If working_tree_changes: "Uncommitted changes: {count} files"}

### Recommendations

Based on the data, provide 2-5 actionable recommendations:

- If failure_rate > 15%: "**Reduce tool failures** -- {specific suggestion based on which tools failed most}"
- If backtracks > 3: "**Clarify requirements** -- {specific files or patterns that caused rework}"
- If cost seems high for the work done: "**Optimize cost** -- Consider using a faster model for {specific phase or task type}"
- If iteration_struggle backtracks exist: "**Address fragile files** -- {list files} triggered repeated edits. Consider more explicit edit instructions."
- If debugging_loop backtracks exist: "**Improve environment setup** -- {specific commands that failed}. Document working commands for future sessions."
- If high read-to-edit ratio: "**Reduce exploration overhead** -- The agent spent significant time reading files. Consider providing more specific file paths in prompts."

---

## Notes

- This report is generated from the distilled session data, not from raw events
- Cost estimates are heuristic-based with ~20% margin of error
- Efficiency scores are relative guidelines, not absolute measures
- Recommendations are suggestions based on patterns, not definitive diagnoses
