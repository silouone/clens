---
description: "Compare two distilled clens sessions side-by-side to identify performance differences"
argument-hint: "<session-id-1> <session-id-2>"
---

# Session Compare

Compare two distilled clens sessions side-by-side to identify performance differences and determine which approach was more effective.

## Variables

TARGET: $ARGUMENTS

## Instructions

### 1. Resolve the Sessions

- If TARGET contains two session IDs (space-separated), use those
- If TARGET is `--last 2` or `--last`, find the two most recent distilled sessions:
  - List files in `.clens/distilled/` sorted by modification time
  - Use the two most recently modified `.json` files
- If TARGET contains only one session ID, use it as Session A and the most recent other session as Session B
- If fewer than 2 distilled sessions exist, tell the user:
  > Need at least 2 distilled sessions to compare. Run `clens distill` on more sessions first.

Label the older session as **Session A** and the newer as **Session B**.

### 2. Read Both Sessions

- Read both distilled JSON files from `.clens/distilled/{sessionId}.json`
- Parse both as `DistilledSession` objects
- Load the `session-analysis` skill for schema and interpretation context

### 3. Generate the Comparison Report

Use the following template. Compute all deltas and provide analysis.

---

## Session Comparison: {session_a_id first 8 chars} vs {session_b_id first 8 chars}

### Metrics Comparison

| Metric | Session A | Session B | Delta | Better |
|--------|-----------|-----------|-------|--------|
| Duration | {a.summary.key_metrics.duration_human} | {b.summary.key_metrics.duration_human} | {difference} | {arrow: shorter is better} |
| Tool calls | {a.stats.tool_call_count} | {b.stats.tool_call_count} | {+/- difference} | {fewer is generally better} |
| Failures | {a.stats.failure_count} | {b.stats.failure_count} | {+/- difference} | {fewer is better} |
| Failure rate | {a.stats.failure_rate as %}% | {b.stats.failure_rate as %}% | {+/- difference}pp | {lower is better} |
| Estimated cost | ${a cost} | ${b cost} | {+/- difference} | {lower is better} |
| Backtracks | {a.backtracks.length} | {b.backtracks.length} | {+/- difference} | {fewer is better} |
| Files touched | {a unique_files count} | {b unique_files count} | {+/- difference} | {context-dependent} |
| Files modified | {a.summary.key_metrics.files_modified} | {b.summary.key_metrics.files_modified} | {+/- difference} | {context-dependent} |
| Thinking blocks | {a.reasoning.length} | {b.reasoning.length} | {+/- difference} | {context-dependent} |

Use arrows or indicators in the "Better" column: mark the session that performed better on each metric, or "--" if roughly equal or context-dependent.

### Narratives

**Session A:** {a.summary.narrative}

**Session B:** {b.summary.narrative}

### Backtrack Comparison

| Type | Session A | Session B |
|------|-----------|-----------|
| failure_retry | {count in A} | {count in B} |
| iteration_struggle | {count in A} | {count in B} |
| debugging_loop | {count in A} | {count in B} |
| **Total** | {a.backtracks.length} | {b.backtracks.length} |

Analysis: {Which session had cleaner execution? Did one session struggle with a specific pattern type? Were the backtracks on the same files or different?}

### Tool Usage Shift

| Tool | Session A | Session B | Change |
|------|-----------|-----------|--------|
{Union of all tools from both sessions. For each tool:
 - Show count in A, count in B, and delta
 - Highlight tools that appear in only one session (added/removed)
 - Sort by absolute delta descending}

Analysis: {What does the tool usage shift reveal? Did the approach change (e.g., more reading and less editing)? Did one session use tools not present in the other?}

### Phase Comparison

**Session A phases:**
{List each phase: name, duration, top tools}

**Session B phases:**
{List each phase: name, duration, top tools}

Analysis: {Compare the phase structures. Did one session have a cleaner progression? Did one spend more time in exploration vs modification? Did one have a debugging phase that the other didn't?}

### File Overlap

{Find files that appear in both sessions' file_map.files}

| File | A reads | A edits | B reads | B edits |
|------|---------|---------|---------|---------|
{For overlapping files, show activity comparison}

Files only in Session A: {count} ({list top 3})
Files only in Session B: {count} ({list top 3})

### Model Comparison

If sessions used different models:
- Session A: {a.stats.model} (est. ${a cost})
- Session B: {b.stats.model} (est. ${b cost})
- Cost difference: {delta}
- Performance difference: {which had fewer failures, fewer backtracks}

If same model: "Both sessions used {model}."

### Verdict

Provide a clear verdict with reasoning:

**{Session A or Session B} was more efficient because:**
1. {Primary reason with supporting data}
2. {Secondary reason with supporting data}
3. {Tertiary reason if applicable}

**What to keep from the better session:**
- {Specific pattern or approach that worked well}

**What to improve from the worse session:**
- {Specific pattern or approach that should be changed}

**Recommendations for future sessions:**
- {1-3 actionable suggestions based on the comparison}

---

## Notes

- Comparisons are most meaningful between sessions working on similar tasks
- Model differences can dominate metrics -- control for model when possible
- Cost comparisons assume the same model pricing applies to both sessions
- Delta values use absolute difference; percentage changes are relative to Session A
