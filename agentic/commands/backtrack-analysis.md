---
description: Deep-dive into backtracking patterns from distilled clens sessions
argument-hint: "[session-id or --last]"
---

# Backtrack Analysis Command

Analyze backtracking patterns from a distilled clens session. Identifies wasted effort: failure retries, iteration struggles, and debugging loops.

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

Read the distilled JSON file at `.clens/distilled/{sessionId}.json` for the full `DistilledSession` object. Focus on: `backtracks`, `file_map`, `decisions`, `reasoning`, `timeline`, `stats`.

No CLI commands are needed — the distilled JSON is the primary data source.

### 3. Analyze Backtracks

For each backtrack entry, determine:

- **Type classification**: `failure_retry`, `iteration_struggle`, or `debugging_loop`
- **Severity**: Based on attempt count, duration, and recurrence
- **Root cause hypothesis**: Infer from error messages, file paths, and reasoning context
- **Prevention strategy**: Actionable recommendation to avoid similar issues

### 4. Identify Hot Files

Cross-reference backtrack `file_path` values to find fragile files:

- Files appearing in 2+ backtracks are flagged as fragile
- Rank by backtrack count descending
- Note the types of backtracks each file triggers

### 5. Assess Tool Reliability

For each tool involved in backtracks:

- Calculate failure-to-success ratio
- Compare against session-wide tool usage from `stats.tools_by_name`
- Flag tools with failure rate above 20%

### 6. Generate Report

Produce a structured report with these sections:

1. **Summary table**: Total backtracks, counts by type, wasted attempts, time in backtracks, percentage of session
2. **Severity assessment**: Low / Medium / High rating with justification
3. **Backtrack details**: Per-backtrack analysis with what happened, reasoning context, root cause, prevention
4. **Hot files**: Table of fragile files with backtrack counts and types
5. **Tool reliability**: Table of tools ranked by failure rate
6. **Timeline context**: Simplified timeline showing events around each backtrack
7. **Prevention checklist**: Actionable items relevant to detected patterns

If zero backtracks are detected, generate a short clean-execution summary instead, noting session stats for context.

## Interpretation Guide

- **failure_retry**: Same tool called again within 10 events after a failure. Usually indicates stale file content or wrong parameters.
- **iteration_struggle**: 4+ edits to the same file within 5 minutes. Suggests unclear requirements or wrong approach.
- **debugging_loop**: 3+ bash commands after a failure. Indicates environment issues or complex error chains.

Some legitimate workflows trigger false positives (e.g., TDD may look like iteration_struggle). Note this when applicable.
