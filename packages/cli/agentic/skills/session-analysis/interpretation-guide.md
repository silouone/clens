# Interpretation Guide

How to read metrics, identify patterns, and derive actionable insights from distilled clens session data.

---

## Key Metrics Reference Ranges

### Failure Rate (`stats.failure_rate`)

| Range | Assessment | Interpretation |
|-------|------------|----------------|
| < 5% | Excellent | Clean execution, agent used tools correctly |
| 5-15% | Normal | Expected friction, especially on unfamiliar codebases |
| 15-30% | Concerning | Possible tool misuse, incorrect paths, or environment issues |
| > 30% | Poor | Agent struggling significantly, likely needs different approach |

**Context matters:** A 20% failure rate during a debugging session is less concerning than 20% during routine file editing. Cross-reference with `backtracks` to understand whether failures were productive (led to eventual success) or wasteful (repeated same mistake).

### Cost Estimate (`stats.cost_estimate.estimated_cost_usd`)

Cost estimates come from two sources, in priority order:

1. **Real token counts** (`is_estimated: false`) -- When hook events or transcript data contain actual token usage (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`), these are used directly. This is the most accurate source.
2. **Heuristic formula** (`is_estimated: true`) -- When real counts are unavailable, a heuristic estimates tokens at approximately +/-20% accuracy:
   - Input tokens: `total_events * 500 + reasoning_chars / 4`
   - Output tokens: `tool_call_count * 200 + reasoning_chars / 4`

Check `cost_estimate.is_estimated` to know which method was used. Heuristic estimates should not be used for billing reconciliation.

**Model pricing (per million tokens):**
| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Claude Opus 4 | $15.00 | $75.00 | $1.50 | $18.75 |
| Claude Sonnet 4 | $3.00 | $15.00 | $0.30 | $3.75 |
| Claude Haiku 4 | $0.80 | $4.00 | $0.08 | $1.00 |

**Cost benchmarks per session:**
- Claude Opus 4: $0.50-$5.00 per typical session (15-60 min)
- Claude Sonnet 4: $0.10-$1.00 per typical session
- Claude Haiku 4: $0.03-$0.30 per typical session

**Cost efficiency signal:** Divide `estimated_cost_usd` by `summary.key_metrics.files_modified`. A cost-per-file above $1.00 on Sonnet suggests inefficiency (excessive reads, retries, or exploration).

### Duration (`stats.duration_ms`)

Wall-clock duration from first to last event. This includes idle time (user away from keyboard, session pauses).

**To estimate active agent time:** Subtract timing gaps classified as `user_idle` and `session_pause` from the decisions array:

```
active_time = duration_ms - sum(gap_ms for gap in decisions where gap.classification in ["user_idle", "session_pause"])
```

**Duration benchmarks:**
- Simple file edit: 1-5 minutes
- Feature implementation: 10-30 minutes
- Complex debugging: 20-60 minutes
- Multi-file refactor: 15-45 minutes

### Backtrack Count (`summary.key_metrics.backtrack_count`)

| Count | Assessment | Interpretation |
|-------|------------|----------------|
| 0 | Clean | No detected rework -- either simple task or agent executed well |
| 1-2 | Normal | Minor friction, typical for real-world development |
| 3-4 | Elevated | Some wasted effort, review backtrack details for patterns |
| 5+ | High | Significant rework, likely unclear requirements or tool issues |

**Severity weighting:** Not all backtracks are equal. Rank by:
1. `debugging_loop` (highest cost -- multiple bash attempts)
2. `iteration_struggle` (high cost -- 4+ edits to one file)
3. `failure_retry` (lowest cost -- single retry)

---

## Pattern Interpretation

### Backtrack Patterns

#### `failure_retry`

**What it means:** A tool call failed and the agent immediately retried with the same tool.

**Common causes:**
- Incorrect file path (typo or wrong directory)
- Edit tool `old_string` not matching file content (stale file state)
- Bash command syntax errors
- Permission denied errors

**What to look for:** Check `error_message` for the failure reason. If the same error repeats across multiple failure_retry entries, the agent is not learning from its mistakes.

**Actionable insight:** If failure_retry patterns cluster on file paths, the agent may need to Read files before editing. If they cluster on Bash, the agent may need to verify command syntax.

#### `iteration_struggle`

**What it means:** The same file was edited 4+ times within 5 minutes. The agent is repeatedly modifying the same code without converging on a solution.

**Common causes:**
- Unclear or ambiguous requirements
- Wrong approach to the problem
- Complex formatting/syntax that the agent keeps getting wrong
- Cascading changes where each fix introduces a new issue

**What to look for:** Check `file_path` to identify the struggled file. Cross-reference with `reasoning` entries near `start_t` to understand what the agent was thinking. Check if the file also appears in `backtracks` of other types.

**Actionable insight:** Files that trigger iteration struggles are candidates for clearer specification in future prompts. Consider breaking the edit into smaller, more explicit instructions.

#### `debugging_loop`

**What it means:** A Bash command failed and the agent tried 3+ subsequent Bash commands to fix the issue.

**Common causes:**
- Environment configuration problems (missing dependencies, wrong versions)
- Complex build/test failures that require multiple diagnostic steps
- Path resolution issues in monorepos
- Intermittent test failures

**What to look for:** Check `command` for the initial failed command. Check `error_message` for the error. Look at the `tool_use_ids` count -- higher counts indicate deeper debugging. Cross-reference with `reasoning` entries for agent's debugging strategy.

**Actionable insight:** Frequent debugging loops suggest environment setup could be documented better, or the agent could be given pre-validated commands.

### Decision Patterns

#### `timing_gap` -- User Idle

**What it means:** A UserPromptSubmit event occurred during the gap. The user was away and then returned with a new prompt.

**Interpretation:** Natural workflow pause. The gap duration reflects user think time or context-switching. Not a performance concern.

#### `timing_gap` -- Session Pause

**What it means:** Gap exceeds 10 minutes with no user prompt. The session was paused (e.g., laptop sleep, lunch break).

**Interpretation:** Exclude from active time calculations. Multiple session pauses may indicate the task was tackled in multiple sittings.

#### `timing_gap` -- Agent Thinking

**What it means:** Gap between 2-10 minutes with no user interaction. The agent was processing a complex request.

**Interpretation:** Long thinking gaps before tool calls may indicate the agent is planning a complex operation. Check `reasoning` entries near this timestamp for insight. Unusually long thinking gaps (>5 min) may indicate the agent is stuck.

#### `tool_pivot`

**What it means:** After a failure, the agent switched to a different tool.

**Healthy pivots:**
- `Bash` -> `Read` (checking file before retrying command)
- `Edit` -> `Read` (re-reading file before re-editing)
- `Grep` -> `Glob` (switching search strategy)

**Concerning pivots:**
- Rapid pivoting between 3+ tools (thrashing)
- Pivoting away from the right tool due to a transient error
- Pivoting to `WebSearch` after local tool failures (avoiding the real problem)

**What to look for:** Check `after_failure` (always true in current detection). Look at the `from_tool` and `to_tool` pair. Multiple pivots from the same `from_tool` suggest that tool is unreliable in the current context.

#### `phase_boundary`

**What it means:** The session transitioned to a different work phase, detected by a time gap (>5 min) or a change in dominant tool usage (>2 min gap with tool shift).

**Healthy phase progression:**
1. File Exploration -> Code Modification -> Debugging (test)
2. Research -> File Exploration -> Code Modification
3. File Exploration -> Code Modification -> File Exploration (review)

**Concerning patterns:**
- Returning to File Exploration after Code Modification multiple times (not understanding the codebase)
- Debugging phase longer than Code Modification phase
- No clear phase boundaries (chaotic tool usage)

---

## File Map Analysis

### High Error Count

A file with `errors > 2` suggests:
- **Fragile code** -- The file has unusual formatting or structure that trips up the Edit tool
- **Incorrect path** -- The agent may be referencing a wrong or moved file
- **Permission issue** -- The file may be read-only or locked

**Action:** Check if the errors are on the same operation type. Multiple Edit errors on one file often mean the agent's `old_string` doesn't match (the file was modified between Read and Edit).

### High Edit Count + Low Read Count

A file with `edits >= 3` and `reads <= 1` indicates **blind editing** -- the agent is making changes without re-reading the file to verify state. This is risky because:
- Each edit depends on the previous edit's success
- The agent's mental model of the file may drift from reality
- Errors compound silently

**Action:** For files with this pattern, verify the final state manually. Consider prompting the agent to Read files between edits.

### Reads Only (No Edits/Writes)

Files with `reads > 0` and `edits === 0` and `writes === 0` indicate **research/understanding** activity. These files were consulted but not modified.

**Interpretation:** A high proportion of read-only files is normal for sessions involving investigation, debugging, or understanding a codebase. If the session goal was to modify code but most files are read-only, the agent may have spent too long exploring.

### Source: "bash" vs "tool"

Files with `source: "bash"` were detected from Bash command parsing (mkdir, cp, mv, rm, redirect, touch) rather than from dedicated file tools. These entries have zero counts for reads/edits/writes because the operation was performed via shell commands.

**Action:** Files discovered through Bash may not have accurate operation counts. Consider them as "touched" but verify the specific operation from the timeline.

---

## Multi-Agent Patterns

The `agents` array (when present) forms a tree of sub-agent sessions. Analysis focuses on coordination efficiency.

### Agent Spawn Count vs Completion

Compare the number of `AgentNode` entries against task completion signals:
- All agents with `duration_ms > 0` completed (had a stop event)
- Agents with `duration_ms === 0` may have been spawned but not stopped (orphaned)

**Healthy ratio:** All spawned agents complete with non-zero duration.
**Concerning:** Multiple agents with `duration_ms === 0` suggests spawning issues or premature session end.

### Message Volume Between Agents

Check `_links.jsonl` for `msg_send` events. High message volume between agents indicates:
- **High coordination overhead** if messages are short status updates
- **Effective delegation** if messages contain substantive work results

**Benchmark:** More than 10 messages per agent suggests the task decomposition was too fine-grained.

### Tree Depth

- **Depth 1** (leader + workers): Simple task delegation, low overhead
- **Depth 2** (leader + sub-leaders + workers): Complex task requiring hierarchical decomposition
- **Depth 3+**: Unusual, may indicate over-decomposition

### Cost Distribution

Compare `tool_call_count` across agents. If one agent has significantly more tool calls than others, the work distribution was uneven. Check if that agent also has the most backtracks (it may have received the hardest sub-task, or may be inefficient).

---

## Cross-Referencing Techniques

### Correlating Backtracks with Reasoning

For each backtrack, find reasoning entries where `t` is near `backtrack.start_t`:
```
reasoning.filter(r => r.t >= backtrack.start_t - 30000 && r.t <= backtrack.end_t + 30000)
```
This reveals what the agent was thinking during the struggle.

### Correlating File Map with Git Diff

Cross-reference `file_map.files` (agent operations) with `git_diff.hunks` (actual committed changes). Files with high agent activity but no git hunks may indicate:
- Work that was discarded or reverted
- Files that were read but not changed
- Changes not yet committed

### Correlating Timeline with Phases

Use `timeline[].phase_index` to group timeline entries by phase. This lets you analyze per-phase tool usage, failure rates, and thinking patterns:
- Which phase had the most failures?
- Which phase had the most thinking blocks?
- Which phase had the longest duration?

### Cost Per Phase

Approximate per-phase cost by counting tool calls within each phase's time range:
```
phase_tool_calls = timeline.filter(e => e.phase_index === i && e.type === "tool_call").length
phase_cost_fraction = phase_tool_calls / stats.tool_call_count
estimated_phase_cost = stats.cost_estimate.estimated_cost_usd * phase_cost_fraction
```
