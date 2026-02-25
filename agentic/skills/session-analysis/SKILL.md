---
name: session-analysis
description: "Schema knowledge and interpretation guide for clens distilled session data. Auto-loads when reading .clens/distilled/ files."
user-invocable: false
---

# Session Analysis

Knowledge base for interpreting clens distilled session data. This skill provides schema documentation and analysis guidance for the `DistilledSession` JSON files produced by `clens distill`.

## What is clens?

clens captures AI agent sessions (Claude Code) as local JSONL event streams via hooks. The `distill` command processes raw events through 23 extractors into a single structured JSON file containing stats, backtracks, decisions, file maps, git diffs, edit chains, diff attribution, reasoning traces, user messages, summaries, timelines, plan drift, active duration, agent tree, agent distillation, agent enrichment, aggregate team data, team metrics, decisions (team), summary (team), communication graphs, communication sequences, agent lifetimes, and journey data.

## Pillars

- [Distill Schema](distill-schema.md) -- Complete type-annotated schema for every field in the distilled JSON output
- [Interpretation Guide](interpretation-guide.md) -- How to read metrics, reference ranges, pattern interpretation, and actionable analysis techniques

## Key Conventions

- **All timestamps** are Unix milliseconds (`number`). Convert with `new Date(t)` for human-readable output.
- **Cost estimates** are USD approximations based on token heuristics (~20% margin). Not billing-accurate.
- **Distilled files** live at `.clens/distilled/{sessionId}.json`. Raw events at `.clens/sessions/{sessionId}.jsonl`.
- **Session IDs** are UUIDs. Use first 8 characters for display (e.g., `a1b2c3d4`).
- **The `complete` flag** indicates whether all extractors ran successfully. If `false`, some sections may be empty.
- **Optional fields** (marked with `?`) are omitted from the JSON when absent, not set to `null`.

## Data Sources (23 Extractors)

| Extractor | Field | Source | Description |
|-----------|-------|--------|-------------|
| stats | `stats` | Hook events | Aggregate counts, durations, tool usage, failure rates, cost |
| backtracks | `backtracks` | Hook events | Failure retries, iteration struggles, debugging loops |
| decisions | `decisions` | Hook events | Timing gaps, tool pivots, phase boundaries |
| file-map | `file_map` | Hook events | Per-file read/edit/write/error counts |
| git-diff | `git_diff` | Git + hooks | Commits, hunks, working tree changes |
| edit-chains | `edit_chains` | Hook + transcript | Thinking-to-code binding, abandoned edits, net changes |
| diff-attribution | `edit_chains.diff_attribution` | Git + hooks | Maps git hunks to specific edit tool_use_ids |
| reasoning | `reasoning` | Transcript | Extended thinking blocks with intent classification |
| user-messages | `user_messages` | Transcript | User prompts, commands, system messages |
| summary | `summary` | Synthesized | Narrative, phases, key metrics, top errors, workload |
| timeline | `timeline` | Synthesized | Chronological interleaved event stream |
| active-duration | (feeds summary) | Synthesized | Active vs idle vs pause time |
| plan-drift | `plan_drift` | Hook + filesystem | Spec vs actual file drift score |
| agent-tree | `agents[]` | Links + hooks | Sub-agent hierarchy tree construction |
| agent-distill | `agents[]` | Transcript per agent | Per-subagent stats, file_map, tokens, model |
| agent-enrich | `agents[]` | Links | Enriches agents with communication, tasks, messages |
| aggregate | (feeds stats, file_map) | Agents + parent | Merges agent data into parent-level aggregates |
| team | `team_metrics` | Links | Agent count, task completions, utilization |
| decisions-team | `decisions` | Links + hooks | Team-level decision extraction with agent context |
| summary-team | `summary` | Links + agents | Team-level summary with agent workload breakdown |
| comm-graph | `communication_graph` | Links | Message edges between agents |
| comm-sequence | `comm_sequence` | Links | Temporal message ordering between agents |
| agent-lifetimes | `agent_lifetimes` | Links | Agent spawn/stop timestamps and lifespans |

*Note: Some extractors share source files (e.g., `agent-lifetimes` lives in `comm-sequence.ts`, `decisions-team` is called from `decisions.ts`, `summary-team` is called from `summary.ts`). Each row represents a distinct extraction function, not necessarily a separate file.*

## When Analyzing Sessions

1. Start with `summary.narrative` for a quick overview
2. Check `summary.key_metrics` for the headline numbers
3. Examine `backtracks` for wasted effort
4. Review `decisions` for workflow patterns
5. Use `file_map.files` to understand code touchpoints
6. Cross-reference `reasoning` for agent thinking context
7. Use `timeline` for chronological reconstruction
