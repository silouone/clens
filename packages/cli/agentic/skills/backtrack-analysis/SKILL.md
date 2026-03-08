---
description: "Deep-dive into backtracking patterns from distilled clens sessions"
argument-hint: "[session-id or --last]"
---

# Backtrack Analysis

Deep-dive into backtracking patterns from a distilled clens session. This command focuses entirely on wasted effort: failure retries, iteration struggles, and debugging loops.

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
- Focus on: `backtracks`, `file_map`, `decisions`, `reasoning`, `timeline`, `stats`
- Load the `session-analysis` skill for schema and interpretation context

### 3. Generate the Analysis

Use the following template. If there are zero backtracks, generate a short clean-execution report instead.

---

## If Zero Backtracks

### Backtrack Analysis: {session_id first 8 chars}

**No backtracks detected.** This session had a clean execution with no detected failure retries, iteration struggles, or debugging loops.

**Session stats for context:**
- Duration: {summary.key_metrics.duration_human}
- Tool calls: {stats.tool_call_count}
- Failure rate: {stats.failure_rate as %}%
- Files modified: {summary.key_metrics.files_modified}

{If stats.failure_count > 0 but no backtracks: "Note: {failure_count} tool failures occurred but none triggered backtracking patterns. The agent recovered without retrying."}

---

## If Backtracks Exist

### Backtrack Analysis: {session_id first 8 chars}

### Summary

| Metric | Value |
|--------|-------|
| Total backtracks | {backtracks.length} |
| failure_retry | {count of type failure_retry} |
| iteration_struggle | {count of type iteration_struggle} |
| debugging_loop | {count of type debugging_loop} |
| Total wasted attempts | {sum of all backtracks' attempts} |
| Time spent backtracking | {sum of (end_t - start_t) for all backtracks, formatted as human duration} |
| % of session in backtracks | {backtrack_time / stats.duration_ms * 100}% |
| Unique files affected | {count of unique file_path values across backtracks} |

### Severity Assessment

Rate the backtrack severity:
- **Low** (1-2 backtracks, <10% of session time): Minor friction, acceptable
- **Medium** (3-4 backtracks, 10-25% of session time): Noticeable waste, review patterns
- **High** (5+ backtracks or >25% of session time): Significant rework, action needed

**Assessment: {Low/Medium/High}** -- {one sentence justification}

### Backtrack Details

For each backtrack, provide deep analysis:

---

#### Backtrack #{index}: {type} on `{tool_name}`

| Field | Value |
|-------|-------|
| Type | {type} |
| Tool | {tool_name} |
| File | {file_path or "N/A"} |
| Attempts | {attempts} |
| Duration | {end_t - start_t} ms ({formatted}) |
| Time range | {new Date(start_t).toISOString()} to {new Date(end_t).toISOString()} |

**What happened:**
{Describe the sequence of events based on the backtrack type:
- For failure_retry: "The agent called {tool_name} on {file_path} and it failed with: {error_message}. The agent then retried the same tool."
- For iteration_struggle: "The agent edited {file_path} {attempts} times within {duration}. This suggests the agent was struggling to get the correct content."
- For debugging_loop: "A Bash command failed ({command}) with error: {error_message}. The agent then tried {attempts - 1} additional Bash commands to resolve the issue."}

**Agent reasoning context:**
{Search reasoning array for entries where t is within [start_t - 30000, end_t + 30000].
If found: "The agent's thinking during this period: {summarize relevant reasoning entries, focusing on intent classification}."
If not found: "No reasoning data available for this time range."}

**Root cause hypothesis:**
{Based on the error_message, file_path, tool_name, and reasoning context, hypothesize the root cause:
- For failure_retry: Was it a bad file path? Stale file content? Wrong tool parameters?
- For iteration_struggle: Was the requirement unclear? Was the agent using wrong approach?
- For debugging_loop: Was it an environment issue? Missing dependency? Complex error chain?}

**Prevention recommendation:**
{Specific, actionable recommendation for avoiding this backtrack in the future:
- "Read the file before editing to ensure the edit target string exists"
- "Verify the directory structure before writing to a nested path"
- "Run the test command manually first to confirm it works"
- "Provide more specific edit instructions instead of 'fix the error'"
- etc.}

---

### Hot Files

Files that appear in multiple backtracks are fragile -- they consistently cause agent rework.

| File | Backtrack Count | Types | Total Attempts |
|------|----------------|-------|----------------|
{For each unique file_path across backtracks, count how many backtracks reference it, list the types, sum the attempts. Sort by backtrack count descending.}

{If any file appears in 2+ backtracks:
"**Fragile files identified:** These files caused repeated agent struggles. Consider:
- Adding comments or documentation to clarify structure
- Breaking large files into smaller, more focused modules
- Providing explicit file content context in future prompts"}

{If no file appears in 2+ backtracks: "No fragile files detected -- backtracks were spread across different files."}

### Tool Reliability

Rank tools by their failure-to-success ratio in this session.

| Tool | Total Calls | Failures | Failure Rate | In Backtracks |
|------|-------------|----------|------------|---------------|
{For each tool in stats.tools_by_name:
- Total calls from tools_by_name count
- Failures: count PostToolUseFailure events for this tool (from events_by_type and backtrack data)
- Failure rate: failures / total calls
- In Backtracks: count of backtracks where this tool is tool_name
Sort by failure rate descending}

{Highlight any tool with failure rate > 20%: "**{tool_name}** has a {rate}% failure rate in this session. This is {above/well above} the normal range. Common causes: {suggestions based on tool type}."}

### Timeline Context

Show backtrack events in the context of the session timeline:

```
{For each major event in the timeline near backtracks, show a simplified timeline:
[timestamp] tool_call: Read src/foo.ts
[timestamp] tool_call: Edit src/foo.ts
[timestamp] failure: Edit src/foo.ts -- "old_string not found"     << BACKTRACK #1 START
[timestamp] tool_call: Read src/foo.ts
[timestamp] tool_call: Edit src/foo.ts                              << BACKTRACK #1 END
[timestamp] tool_call: Bash "bun test"
}
```

Only include 2-3 events before and after each backtrack for context. Use the timeline array entries where phase_index or tool_use_id overlaps with backtrack tool_use_ids.

### Prevention Checklist

Based on the patterns found in this session:

{Generate a checklist of prevention measures, selecting ONLY items relevant to the detected backtracks:}

- [ ] **Read before Edit** -- Always read a file before editing to ensure the edit target exists (relevant if failure_retry on Edit tool)
- [ ] **Verify paths** -- Check file/directory existence before write operations (relevant if failure_retry with path errors)
- [ ] **Test incrementally** -- Run tests after each logical change, not after batch edits (relevant if debugging_loop)
- [ ] **Smaller edits** -- Break large edits into smaller, verifiable steps (relevant if iteration_struggle)
- [ ] **Check command syntax** -- Validate Bash commands before execution (relevant if debugging_loop with Bash)
- [ ] **Re-read after failure** -- After any tool failure, re-read the target to understand current state (relevant if failure_retry)
- [ ] **Explicit requirements** -- Provide more specific instructions for the problematic areas: {list specific files or operations from backtracks}
- [ ] **Environment setup** -- Document working commands for: {list specific commands from debugging_loop backtracks}

---

## Notes

- Backtrack detection uses heuristics: failure_retry (same tool within 10 events), iteration_struggle (4+ edits in 5 min), debugging_loop (3+ bash after failure)
- Some legitimate workflows may be flagged (e.g., iterative test-driven development may trigger iteration_struggle)
- Root cause hypotheses are educated guesses based on patterns, not definitive diagnoses
- Prevention recommendations are suggestions -- not all backtracks are preventable
