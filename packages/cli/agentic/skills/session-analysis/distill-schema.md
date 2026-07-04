# Distill Schema

Complete type-annotated schema for the `DistilledSession` JSON output. This is the source of truth for all distilled session data. Every field documented here maps directly to the TypeScript types in `src/types/distill.ts`.

## Root: DistilledSession

```typescript
{
  session_id: string;                      // UUID of the captured session
  session_name?: string;                   // Human-readable session name (from transcript)
  start_time?: number;                     // Timestamp (Unix ms) of the first event
  stats: StatsResult;                      // Aggregate statistics
  backtracks: BacktrackResult[];           // Detected backtracking patterns
  decisions: DecisionPoint[];              // Decision points and workflow transitions
  file_map: FileMapResult;                 // Per-file operation counts
  git_diff: GitDiffResult;                 // Git changes during session
  edit_chains?: EditChainsResult;          // Edit chain tracking with thinking-to-code binding
  reasoning: TranscriptReasoning[];        // Extended thinking blocks from transcript
  user_messages: TranscriptUserMessage[];  // User inputs from transcript
  transcript_path?: string;                // Absolute path to source transcript file
  summary?: DistilledSummary;              // Synthesized narrative and key metrics
  timeline?: TimelineEntry[];              // Chronological interleaved event stream (capped at 500)
  agents?: AgentNode[];                    // Sub-agent hierarchy tree (multi-agent sessions only)
  cost_estimate?: CostEstimate;            // Root-level cost estimate (may differ from stats.cost_estimate)
  team_metrics?: TeamMetrics;              // Team coordination metrics (multi-agent only)
  communication_graph?: CommunicationEdge[];  // Message edges between agents (multi-agent only)
  comm_sequence?: CommunicationSequenceEntry[];  // Temporal message ordering (multi-agent only)
  agent_lifetimes?: AgentLifetime[];       // Agent spawn/stop timestamps (multi-agent only)
  plan_drift?: PlanDriftReport;            // Spec vs actual file drift analysis
  complete: boolean;                       // Whether all extractors completed successfully
}
```

---

## StatsResult

Aggregate statistics computed from hook events. The primary quantitative overview of the session.

```typescript
{
  total_events: number;                    // Total hook events captured
  duration_ms: number;                     // Wall-clock duration (last event t - first event t)
  events_by_type: Record<string, number>;  // Count per hook event type
  // Keys: "SessionStart" | "SessionEnd" | "UserPromptSubmit" | "PreToolUse" |
  //        "PostToolUse" | "PostToolUseFailure" | "PermissionRequest" | "Notification" |
  //        "SubagentStart" | "SubagentStop" | "Stop" | "TeammateIdle" |
  //        "TaskCompleted" | "PreCompact"

  tools_by_name: Record<string, number>;   // Count per tool name (from PreToolUse events)
  // Common keys: "Read" | "Edit" | "Write" | "Bash" | "Glob" | "Grep" |
  //              "WebSearch" | "WebFetch" | "NotebookEdit" | "Skill" | "Task" | ...

  tool_call_count: number;                 // Total PreToolUse events with a tool_name
  failure_count: number;                   // Total PostToolUseFailure events
  failure_rate: number;                    // failure_count / tool_call_count (0.0 to 1.0)
  unique_files: string[];                  // Deduplicated file paths from tool inputs
  model?: string;                          // Model name from SessionStart context (e.g., "claude-opus-4")
  cost_estimate?: CostEstimate;            // Token and cost estimates (present when model is known)
  failures_by_tool?: Record<string, number>;  // Failure count per tool name
}
```

## CostEstimate

Token and cost estimates. When real token usage is available from transcript, uses actual counts. Otherwise falls back to heuristic estimation (~20% accuracy).

```typescript
{
  model: string;                           // Model name used for pricing lookup
  estimated_input_tokens: number;          // Real or heuristic: total_events * 500 + reasoning_chars / 4
  estimated_output_tokens: number;         // Real or heuristic: tool_call_count * 200 + reasoning_chars / 4
  estimated_cost_usd: number;              // Rounded to 4 decimal places
  cache_read_tokens?: number;              // Prompt cache read tokens (from real usage)
  cache_creation_tokens?: number;          // Prompt cache creation tokens (from real usage)
  is_estimated?: boolean;                  // True if heuristic, false/absent if from real token counts
}
```

**Supported models for pricing (per million tokens):**

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| `claude-opus-4` | $15.00 | $75.00 | $1.50 | $18.75 |
| `claude-sonnet-4` | $3.00 | $15.00 | $0.30 | $3.75 |
| `claude-haiku-4` | $0.80 | $4.00 | $0.08 | $1.00 |

---

## BacktrackResult

Detected backtracking patterns where the agent retried, struggled, or entered debugging loops. Each entry represents wasted effort.

```typescript
{
  type: "failure_retry" | "iteration_struggle" | "debugging_loop";  // Discriminated union tag
  tool_name: string;                       // Primary tool involved
  file_path?: string;                      // File path if applicable
  attempts: number;                        // Number of attempts in this backtrack
  start_t: number;                         // Timestamp (Unix ms) of first event
  end_t: number;                           // Timestamp (Unix ms) of last event
  tool_use_ids: string[];                  // IDs of all tool uses in this backtrack
  error_message?: string;                  // Truncated to 500 chars. Present for failure_retry and debugging_loop
  command?: string;                        // Bash command if applicable. Truncated to 300 chars
}
```

### Backtrack Type Variants

**`failure_retry`** -- A PostToolUseFailure followed by a PreToolUse with the same tool within the next 10 events.
- `attempts`: Always 2 (the failure + the retry)
- `error_message`: The error from the failed attempt
- `file_path`: From tool input if present

**`iteration_struggle`** -- Same file edited 4+ times within a 5-minute window (Edit or Write tools).
- `attempts`: Number of edits in the window (4+)
- `tool_name`: Always "Edit"
- `file_path`: Always present (the struggled file)
- `error_message`: Not set

**`debugging_loop`** -- A Bash failure followed by 3+ consecutive Bash commands.
- `attempts`: Total commands including the initial failure (3+)
- `tool_name`: Always "Bash"
- `error_message`: Error from the initial Bash failure
- `command`: The initial failed command

---

## DecisionPoint (Discriminated Union)

Workflow transitions and notable events. Discriminated by `type`.

### TimingGapDecision

```typescript
{
  type: "timing_gap";
  t: number;                               // Timestamp of the event after the gap
  gap_ms: number;                          // Duration of the gap in milliseconds
  classification: "user_idle" | "session_pause" | "agent_thinking";
}
```

**Classification logic:**
- `user_idle` -- A UserPromptSubmit event occurred during the gap (user was away, then returned)
- `session_pause` -- Gap exceeds 10 minutes with no user prompt
- `agent_thinking` -- Gap between 2-10 minutes with no user prompt

**Thresholds:** Gaps under 30 seconds are ignored. Gaps under 2 minutes that are not `session_pause` are suppressed as noise.

### ToolPivotDecision

```typescript
{
  type: "tool_pivot";
  t: number;                               // Timestamp of the new tool use
  from_tool: string;                       // Tool that failed
  to_tool: string;                         // Tool used after failure
  after_failure: boolean;                  // Always true (pivots are only detected after failures)
}
```

**Detection:** After a PostToolUseFailure, look ahead up to 10 events for a PreToolUse with a different tool name.

### PhaseBoundaryDecision

```typescript
{
  type: "phase_boundary";
  t: number;                               // Timestamp of the phase start
  phase_name: string;                      // Name of the new phase
  phase_index: number;                     // 1-based index (first boundary is index 1)
}
```

**Phase detection triggers:**
- Time gap > 5 minutes between events
- Time gap > 2 minutes AND the dominant tool in the next 10 events differs from the previous 10

### AgentSpawnDecision

```typescript
{
  type: "agent_spawn";
  t: number;                               // Timestamp of the spawn event
  agent_id: string;                        // Session ID of the spawned agent
  agent_name: string;                      // Human-readable name
  agent_type: string;                      // Agent type (e.g., "builder", "reviewer")
  parent_session: string;                  // Session ID of the spawning agent
}
```

**Detection:** Generated from SpawnLink events in `_links.jsonl`.

### TaskDelegationDecision

```typescript
{
  type: "task_delegation";
  t: number;                               // Timestamp of the task assignment
  task_id: string;                         // Task identifier
  agent_name: string;                      // Agent assigned to the task
  subject?: string;                        // Task subject/title
}
```

**Detection:** Generated from task assignment events in links.

### TaskCompletionDecision

```typescript
{
  type: "task_completion";
  t: number;                               // Timestamp of task completion
  task_id: string;                         // Task identifier
  agent_name: string;                      // Agent that completed the task
  subject?: string;                        // Task subject/title
}
```

**Detection:** Generated from TaskCompleted events in links.

---

## FileMapResult

Per-file operation counts aggregated from tool events and Bash command parsing.

```typescript
{
  files: FileMapEntry[];                   // Sorted by (edits + writes + errors) descending
}
```

### FileMapEntry

```typescript
{
  file_path: string;                       // Absolute or relative file path
  reads: number;                           // Count of Read tool uses on this file
  edits: number;                           // Count of Edit tool uses on this file
  writes: number;                          // Count of Write tool uses on this file
  errors: number;                          // Count of PostToolUseFailure events on this file
  tool_use_ids: string[];                  // All tool_use_id values touching this file
  source?: "tool" | "bash";               // How the file was discovered
}
```

**Source types:**
- `tool` -- File discovered from Read/Edit/Write/Glob/Grep tool inputs
- `bash` -- File path extracted from Bash command patterns (mkdir, cp, mv, rm, redirect, touch)

---

## GitDiffResult

Git changes detected during the session timeframe.

```typescript
{
  commits: string[];                       // Commit hashes made during session
  hunks: GitDiffHunk[];                    // Per-file change statistics from commits
  working_tree_changes?: WorkingTreeChange[];  // Unstaged changes at distill time
  staged_changes?: WorkingTreeChange[];    // Staged changes at distill time
}
```

**Important:** `working_tree_changes` and `staged_changes` reflect the state at **distill time**, not session time. They may differ if the user made changes between session end and distill.

### GitDiffHunk

```typescript
{
  commit_hash: string;                     // The commit this hunk belongs to
  file_path: string;                       // File that was changed
  additions: number;                       // Lines added
  deletions: number;                       // Lines removed
  matched_tool_use_id?: string;            // Correlated Edit/Write tool_use_id if matched by file path
}
```

### WorkingTreeChange

```typescript
{
  file_path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions?: number;                      // Lines added (from git diff --numstat)
  deletions?: number;                      // Lines removed
}
```

---

## EditChainsResult

Edit chain tracking with thinking-to-code binding, diff attribution, and net change analysis.

```typescript
{
  chains: EditChain[];                     // Per-file edit sequences
  net_changes?: WorkingTreeChange[];       // Net file changes (from git diff)
  diff_attribution?: FileDiffAttribution[];  // Per-line attribution of git diffs to agents
}
```

### EditChain

```typescript
{
  file_path: string;                       // File being edited
  steps: EditStep[];                       // Ordered sequence of read/edit/write operations
  total_edits: number;                     // Total Edit tool uses on this file
  total_failures: number;                  // Failed edit attempts
  total_reads: number;                     // Read operations on this file
  effort_ms: number;                       // Time from first to last step
  has_backtrack: boolean;                  // Whether any step overlaps with a backtrack
  surviving_edit_ids: string[];            // tool_use_ids of edits that persisted
  abandoned_edit_ids: string[];            // tool_use_ids of edits that were overwritten
  agent_name?: string;                     // Agent that performed these edits (multi-agent)
}
```

### EditStep

```typescript
{
  tool_use_id: string;                     // Unique tool use identifier
  t: number;                               // Timestamp (Unix ms)
  tool_name: "Edit" | "Write" | "Read";   // Tool used in this step
  outcome: "success" | "failure" | "info"; // Result of the operation
  old_string_preview?: string;             // Edit old_string (truncated)
  new_string_preview?: string;             // Edit new_string (truncated)
  old_string_lines?: number;              // Line count of old_string
  new_string_lines?: number;              // Line count of new_string
  content_lines?: number;                  // Line count for Write content
  error_preview?: string;                  // Error message if failure
  thinking_preview?: string;               // Associated reasoning (truncated)
  thinking_intent?: "planning" | "debugging" | "research" | "deciding" | "general";
  backtrack_type?: "failure_retry" | "iteration_struggle" | "debugging_loop";
}
```

### FileDiffAttribution

```typescript
{
  file_path: string;                       // File with attributed diff
  lines: DiffLine[];                       // Per-line attribution
  total_additions: number;                 // Lines added
  total_deletions: number;                 // Lines removed
}
```

### DiffLine

```typescript
{
  type: "add" | "remove" | "context";      // Line change type
  content: string;                         // Line content
  agent_name?: string;                     // Agent responsible (multi-agent)
  line_number?: number;                    // Line number in file
}
```

---

## TranscriptReasoning

Extended thinking blocks extracted from the Claude Code transcript. Provides insight into agent decision-making.

```typescript
{
  t: number;                               // Timestamp (Unix ms) from transcript entry
  thinking: string;                        // Thinking content, truncated to 5000 chars
  tool_use_id?: string;                    // ID of the next tool_use block after this thinking block
  tool_name?: string;                      // Name of the correlated tool
  intent?: "planning" | "debugging" | "research" | "deciding" | "general";
  truncated?: boolean;                     // True if original thinking exceeded 5000 chars
}
```

**Intent classification** (keyword-based):
- `debugging` -- Contains: error, fix, bug, fail, crash, broken, issue, wrong, debug
- `planning` -- Contains: plan, approach, strategy, design, architect, phase, step
- `research` -- Contains: search, look up, check, investigate, find, read, explore
- `deciding` -- Contains: should, decide, option, choose, between, alternative, trade-off
- `general` -- Default when no keywords match

---

## TranscriptUserMessage

User inputs extracted from the transcript.

```typescript
{
  t: number;                               // Timestamp (Unix ms)
  content: string;                         // Message content, truncated to 2000 chars
  is_tool_result: boolean;                 // Always false (tool results are filtered out)
  message_type?: "prompt" | "command" | "system" | "teammate" | "image";
  teammate_name?: string;                  // Present when message_type is "teammate"
  image_path?: string;                     // Present when message_type is "image"
}
```

**Message type classification:**
- `command` -- Contains `<command-name>` or `<command-message>` tags
- `teammate` -- Contains `<teammate-message` tag
- `image` -- Contains `[Image:` or `screenshot`
- `system` -- Contains `<local-command` or `<system-reminder` tags
- `prompt` -- Default (direct user input)

---

## DistilledSummary

Synthesized overview combining data from multiple extractors.

```typescript
{
  narrative: string;                       // Human-readable 1-3 sentence summary
  phases: PhaseInfo[];                     // Detected workflow phases
  key_metrics: {
    duration_human: string;                // Formatted duration (e.g., "5m 30s", "1h 20m 5s")
    tool_calls: number;                    // Same as stats.tool_call_count
    failures: number;                      // Same as stats.failure_count
    files_modified: number;                // Files with edits > 0 or writes > 0
    backtrack_count: number;               // Length of backtracks array
    active_duration_human?: string;        // Formatted active duration (excl. idle/pause)
    active_duration_ms?: number;           // Active duration in milliseconds
    abandoned_edits?: number;              // Count of edits that were overwritten
    edit_chains_count?: number;            // Number of edit chains
  };
  top_errors?: Array<{
    tool_name: string;                     // Tool that failed
    count: number;                         // Failure count
    sample_message?: string;               // Example error message
  }>;
  task_summary?: Array<{                   // Multi-agent: task completion log
    task_id: string;
    agent: string;
    subject?: string;
    t: number;
  }>;
  agent_workload?: Array<{                 // Multi-agent: per-agent workload
    name: string;
    id: string;
    tool_calls: number;
    files_modified: number;
    duration_ms: number;
  }>;
}
```

### PhaseInfo

```typescript
{
  name: string;                            // Phase name (see classification below)
  start_t: number;                         // Timestamp of first event in phase
  end_t: number;                           // Timestamp of last event in phase
  tool_types: string[];                    // Tools used, sorted by frequency descending
  description: string;                     // "{name} phase with {N} events"
}
```

**Phase name classification** (based on dominant tool):
- `"File Exploration"` -- Read, Glob, Grep
- `"Code Modification"` -- Edit, Write
- `"Research"` -- WebSearch, WebFetch
- `"Debugging"` -- Bash with failures
- `"General"` -- Everything else or no dominant tool

---

## TimelineEntry

Chronological interleaved event stream. Combines hook events, reasoning, user messages, backtracks, phase boundaries, and multi-agent events into a single sorted array. **Capped at 500 entries** with even sampling that preserves structural events (phase boundaries and user prompts).

```typescript
{
  t: number;                               // Timestamp (Unix ms)
  type: "user_prompt" | "thinking" | "tool_call" | "tool_result" | "failure" |
        "backtrack" | "phase_boundary" | "teammate_idle" | "task_complete" |
        "agent_spawn" | "agent_stop" | "task_create" | "task_assign" | "msg_send";
  tool_name?: string;                      // Present for tool_call, failure, thinking, backtrack
  tool_use_id?: string;                    // Present for tool_call, failure, thinking
  content_preview?: string;                // Truncated content (200 chars for most, full for phase names)
  phase_index?: number;                    // Index into summary.phases array
  teammate_name?: string;                  // Present for teammate_idle
  agent_id?: string;                       // Present for agent_spawn, agent_stop
  agent_name?: string;                     // Present for agent_spawn, agent_stop
  task_id?: string;                        // Present for task_complete, task_create, task_assign
  task_subject?: string;                   // Present for task_complete, task_create, task_assign
  msg_from?: string;                       // Present for msg_send
  msg_to?: string;                         // Present for msg_send
}
```

**Entry sources:**
- `user_prompt` -- From user messages with `message_type === "prompt"`
- `thinking` -- From reasoning blocks (content_preview = first 200 chars of thinking)
- `tool_call` -- From PreToolUse hook events
- `failure` -- From PostToolUseFailure hook events (content_preview = error message)
- `backtrack` -- From detected backtracks (content_preview = "{type}: {attempts} attempts")
- `phase_boundary` -- From phase detection (content_preview = phase name)
- `teammate_idle` -- From TeammateIdle link events
- `task_complete` -- From TaskCompleted link events
- `agent_spawn` -- From SubagentStart link events
- `agent_stop` -- From SubagentStop link events
- `task_create` -- From task creation link events
- `task_assign` -- From task assignment link events
- `msg_send` -- From message send link events

---

## AgentNode

Sub-agent hierarchy tree. Only present in multi-agent (team) sessions where sub-agents were spawned. Built from the `_links.jsonl` file and enriched with transcript and link data.

```typescript
{
  session_id: string;                      // Session ID of this agent
  agent_type: string;                      // Agent type (e.g., "builder", "reviewer")
  agent_name?: string;                     // Human-readable agent name
  duration_ms: number;                     // Time from spawn to stop (0 if stop not recorded)
  tool_call_count: number;                 // Estimated from PreToolUse events in agent's time range
  children: AgentNode[];                   // Recursively nested sub-agents
  tasks_completed?: number;                // Number of tasks completed by this agent
  idle_count?: number;                     // Number of idle events
  model?: string;                          // Model used by this agent
  transcript_path?: string;                // Path to agent's transcript file
  task_prompt?: string;                    // Initial task prompt given to this agent
  stats?: AgentStats;                      // Detailed per-agent statistics (from --deep distill)
  file_map?: FileMapResult;                // Per-file operations by this agent
  cost_estimate?: CostEstimate;            // Cost estimate for this agent
  messages?: AgentMessage[];               // Messages sent/received by this agent
  task_events?: AgentTaskEvent[];          // Task lifecycle events for this agent
  idle_periods?: AgentIdlePeriod[];        // Idle notifications from this agent
  communication_partners?: AgentCommunicationPartner[];  // Message partners summary
  edit_chains?: EditChainsResult;          // Edit chains for this agent
  backtracks?: BacktrackResult[];          // Backtracks by this agent
  reasoning?: TranscriptReasoning[];       // Thinking blocks from this agent
}
```

### AgentStats

```typescript
{
  tool_call_count: number;                 // Total tool calls by this agent
  failure_count: number;                   // Failed tool calls
  tools_by_name: Record<string, number>;   // Tool usage breakdown
  unique_files: string[];                  // Files touched by this agent
  token_usage?: TokenUsage;                // Real token counts from transcript
}
```

### AgentMessage

```typescript
{
  t: number;                               // Timestamp
  direction: "sent" | "received";          // Message direction relative to this agent
  partner: string;                         // Other agent's name
  msg_type: string;                        // Message type (e.g., "message", "task_complete")
  summary?: string;                        // Message summary
}
```

### AgentTaskEvent

```typescript
{
  t: number;                               // Timestamp
  action: "create" | "assign" | "status_change" | "complete";
  task_id: string;                         // Task identifier
  subject?: string;                        // Task subject
  status?: string;                         // New status (for status_change)
  owner?: string;                          // Task owner (for assign)
}
```

### AgentIdlePeriod

```typescript
{
  t: number;                               // Timestamp of idle notification
  teammate: string;                        // Agent name that went idle
}
```

### AgentCommunicationPartner

```typescript
{
  name: string;                            // Partner agent name
  sent_count: number;                      // Messages sent to partner
  received_count: number;                  // Messages received from partner
  total_count: number;                     // Total messages exchanged
  msg_types: string[];                     // Types of messages exchanged
}
```

**Tree construction:** Root nodes are agents spawned by the main session. Children are agents spawned by those agents. The tree is built from SpawnLink and StopLink events in `_links.jsonl`. Enrichment adds communication data, task events, and per-agent statistics.

---

## TeamMetrics

Team coordination metrics for multi-agent sessions.

```typescript
{
  agent_count: number;                     // Total agents spawned
  task_completed_count: number;            // Tasks marked as completed
  idle_event_count: number;                // Total idle notifications
  teammate_names: string[];                // Names of all teammates
  tasks: Array<{                           // Task completion log
    task_id: string;
    agent: string;
    subject?: string;
    t: number;
  }>;
  idle_transitions: Array<{               // Idle notification log
    teammate: string;
    t: number;
  }>;
  utilization_ratio?: number;              // Active time / total time (0.0 to 1.0)
}
```

---

## CommunicationEdge

Message edges between agents in the communication graph.

```typescript
{
  from_id: string;                         // Sender agent session UUID
  from_name: string;                       // Sender human-readable name
  to_id: string;                           // Receiver agent session UUID
  to_name: string;                         // Receiver human-readable name
  from: string;                            // Alias for from_name (backward compat)
  to: string;                              // Alias for to_name (backward compat)
  count: number;                           // Total messages on this edge
  msg_types: string[];                     // Types of messages sent
  edge_type?: "message" | "task_complete" | "idle_notify" | "task_assign";
}
```

---

## CommunicationSequenceEntry

Temporal message ordering between agents.

```typescript
{
  t: number;                               // Timestamp (Unix ms)
  from_id: string;                         // Sender agent session UUID
  from_name: string;                       // Sender human-readable name
  to_id: string;                           // Receiver agent session UUID
  to_name: string;                         // Receiver human-readable name
  from: string;                            // Alias for from_name (backward compat)
  to: string;                              // Alias for to_name (backward compat)
  msg_type: string;                        // Message type
  summary?: string;                        // Message summary
  content_preview?: string;                // Truncated message content
  edge_type?: "message" | "task_complete" | "idle_notify" | "task_assign";
}
```

---

## AgentLifetime

Agent spawn/stop timestamps and lifespans.

```typescript
{
  agent_id: string;                        // Agent session UUID
  agent_name?: string;                     // Human-readable name
  start_t: number;                         // Spawn timestamp (Unix ms)
  end_t: number;                           // Stop timestamp (Unix ms, 0 if not stopped)
  agent_type: string;                      // Agent type
}
```

---

## Journey

Cross-session development lifecycle. Groups chained sessions (same cwd, started via clear/compact within 5s) into a coherent workflow with phase classification and lifecycle detection.

```typescript
{
  id: string;                                // First 8 chars of the first session's UUID
  phases: JourneyPhase[];                    // Ordered list of session phases
  transitions: PhaseTransition[];            // Transitions between consecutive phases
  spec_ref?: string;                         // Spec file path from a /build phase (e.g., "specs/foo.md")
  lifecycle_type: LifecycleType;             // Classified workflow pattern
  cumulative_stats: CumulativeStats;         // Aggregated metrics across all phases
  plan_drift?: PlanDriftReport;              // Plan vs. actual file comparison (requires spec_ref)
}
```

---

## JourneyPhase

A single session within a journey, classified by its dominant activity.

```typescript
{
  session_id: string;                        // UUID of the session
  phase_type: PhaseType;                     // Classified phase type
  prompt?: string;                           // First user prompt, truncated to 200 chars
  spec_ref?: string;                         // Spec file referenced in /build prompt
  source: "startup" | "clear" | "compact";   // How this session started
  duration_ms: number;                       // Session wall-clock duration
  event_count: number;                       // Total hook events in this session
}
```

---

## PhaseType

Discriminated classification of a session's dominant activity. Determined from the first user prompt and tool usage patterns.

```typescript
type PhaseType =
  | "prime"              // /prime command -- context priming
  | "brainstorm"         // /brainstorm command -- ideation
  | "plan"               // /plan or /plan_w_team command -- structured planning
  | "build"              // /build command -- implementation
  | "review"             // /review command -- code review
  | "test"               // /test command -- test execution
  | "commit"             // "commit" in prompt -- git operations
  | "exploration"        // Read:write ratio > 3:1 -- read-heavy exploration
  | "orchestrated_build" // >3 TaskCreate tool calls (4+) -- multi-agent coordinated build
  | "freeform"           // Default -- no dominant pattern detected
  | "abort";             // <30s duration and <15 events -- likely abandoned
```

**Classification priority** (first match wins):
1. Slash commands in prompt (`/prime`, `/brainstorm`, `/plan`, `/build`, `/review`, `/test`)
2. "commit" keyword in prompt
3. Tool usage ratios (exploration, orchestrated_build)
4. Duration/event thresholds (abort)
5. Default (freeform)

---

## LifecycleType

High-level workflow classification based on the set of phase types present in a journey.

```typescript
type LifecycleType =
  | "prime-plan-build"   // Has prime + plan + build phases
  | "prime-build"        // Has prime + build phases (no plan)
  | "build-only"         // Has build phase but no prime
  | "single-session"     // Only one phase (one session)
  | "ad-hoc";            // No recognized lifecycle pattern
```

---

## PhaseTransition

Describes how one session transitioned to the next within a journey.

```typescript
{
  from_session: string;                      // Session ID of the preceding phase
  to_session: string;                        // Session ID of the following phase
  gap_ms: number;                            // Time gap between sessions (end of from -> start of to)
  trigger: TransitionTrigger;                // What caused the new session
  git_changed: boolean;                      // Whether git commit changed between sessions
  prompt_shift: string;                      // First 80 chars of the new session's first prompt
}
```

### TransitionTrigger

```typescript
type TransitionTrigger = "clear" | "compact_manual" | "compact_auto";
```

- `clear` -- User ran `/clear` to reset context
- `compact_auto` -- Context compaction (manual or automatic). Currently all compact sources produce this value
- `compact_manual` -- Reserved for future use. Not currently produced by the code

---

## CumulativeStats

Aggregated metrics across all phases in a journey.

```typescript
{
  total_duration_ms: number;                 // Sum of all phase durations
  total_events: number;                      // Sum of all phase event counts
  total_tool_calls: number;                  // Sum from distilled stats (when available)
  total_failures: number;                    // Sum from distilled stats (when available)
  phase_count: number;                       // Number of phases in the journey
  retry_count: number;                       // Number of "abort" phases (likely retries)
}
```

---

## PlanDriftReport

Comparison of expected files (from a spec) vs. actual files touched during the journey. Only present when a `/build` phase references a spec file.

```typescript
{
  spec_path: string;                         // Path to the spec file
  expected_files: string[];                  // Files mentioned in the spec
  actual_files: string[];                    // Files actually touched (from distilled file maps)
  unexpected_files: string[];                // Files touched but not in spec
  missing_files: string[];                   // Files in spec but not touched
  drift_score: number;                       // 0.0 (perfect alignment) to 1.0 (complete divergence)
}
```

**Drift score interpretation:**
- `< 0.3` -- Good alignment with spec
- `0.3 - 0.7` -- Moderate drift, some divergence
- `> 0.7` -- High drift, significant departure from plan
