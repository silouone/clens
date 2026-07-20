---
id: clens-007-codex-rollout-import
type: feat
status: in-review
priority: 1
created: 2026-07-20
caps: { minutes: 90, turns: 400 }
attempts: []
---
# Codex rollout import — rollout→StoredEvent mapper + `clens import codex`

cLens is capture-first (live Claude hook → `.clens/sessions/{sid}.jsonl`). Codex
has no hook API but writes a native "rollout" JSONL at
`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. This ticket makes Codex a genuine
importer: read a rollout → emit Claude-hook-shaped `StoredEvent[]` → write the
session file so `distill`/TUI/web work unchanged (spec option **A**, lowest blast
radius). See `specs/codex-rollout-import.md`.

## Task

1. **Pure mapper** `packages/cli/src/session/rollout.ts` (parallels
   `session/transcript.ts`): `rolloutToStoredEvents(records) → StoredEvent[]`.
   - `session_meta` → `SessionStart` with `context` (model from a look-ahead to
     the first `turn_context.payload.model`, cwd, git branch/commit/remote).
   - `event_msg:user_message` → `UserPromptSubmit` (`data.prompt`).
   - `response_item:function_call` / `custom_tool_call` → `PreToolUse`
     (`tool_name` mapped, `tool_input` = parsed args, `tool_use_id` = `call_id`).
   - `response_item:function_call_output` / `custom_tool_call_output` /
     `event_msg:patch_apply_end` → `PostToolUse` (`tool_name` looked up by
     `call_id`, `tool_response`). apply_patch's PostToolUse comes from
     `patch_apply_end` (structured `changes`); its `custom_tool_call_output`
     twin is dropped to avoid a duplicate pairing.
   - `event_msg:task_complete` → `Stop` (`last_agent_message`, `duration_ms`).
   - A single terminal `SessionEnd` carries the cumulative session usage
     (`data.usage`, mapped from the LAST `token_count.total_token_usage`) so the
     status derives `complete` and `extractTokenUsage`'s SUM equals the total
     (usage on exactly ONE event — every other mapped event is usage-free).
   - Tool-name map: `exec_command`/`exec`/`shell` → `Bash`, `apply_patch` →
     `Edit`; other custom tools pass through.
   - `tool_use_id` = `call_id` on BOTH Pre and Post (never `fc_…` id) so pairs
     match.

2. **Command** `clens import codex <rollout-file|dir>`
   (`packages/cli/src/commands/import.ts` + `cli.ts` table). Reads the file(s),
   maps, and **overwrites** `.clens/sessions/{sid}.jsonl` (the importer emits the
   full set at once; re-import must replace, not append). A directory imports
   every `rollout-*.jsonl` under it.

3. Strict TDD, tests in `packages/cli/test/rollout-import.test.ts`, red-first
   against a hand-built tiny fixture (never commit a real 60 MB rollout).

## Gotchas (from the spec — don't re-earn)
- `total_token_usage` is cumulative/monotonic → take the last; `last_token_usage`
  is a per-turn delta (don't sum).
- Model slug is in `turn_context`, not `session_meta`.
- Reasoning is encrypted → skipped for MVP (no plaintext to distill).
- `patch_apply_end.changes` is an ARRAY of `{path,type,unified_diff}` (spec's
  map shape was wrong).

## Gate
`bun run typecheck && bun run lint && bun test`
