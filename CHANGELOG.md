# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-02-25

### Added

#### Tiered Hook Installation
- `clens init` now writes hooks to `.claude/settings.local.json` (gitignored) instead of `.claude/settings.json` — no more polluting the repo
- `clens init --global` installs hooks to `~/.claude/settings.json` for all projects
- `clens init plugin` now installs both analysis tools AND capture hooks in one command
- `clens init --status` shows installation state across all tiers (Local, Global, Plugin, Legacy)
- `clens init --remove --legacy` removes hooks from `.claude/settings.json` (legacy location)
- Legacy detection: warns when hooks exist in `.claude/settings.json` and suggests migration
- Multi-tier deduplication warning when hooks are installed in multiple tiers
- `agentic/hooks/hooks.json` — plugin hooks file with all 17 hook events

### Changed
- `init()` refactored with `InitTarget` type (`"local" | "global"`) and `resolveInitPaths` helper
- `uninit` detects and removes hooks from all active tiers
- `installPlugin` merges capture hooks into user-level settings with backup
- `uninstallPlugin` removes capture hooks from user-level settings
- `validatePluginStructure` now checks for `hooks/hooks.json`
- `readSettingsFile` handles malformed JSON gracefully (try/catch)
- Type-safe parsing: replaced `as` casts on untrusted data with type guards
- 1137 tests across 49 test files (was 1086 across 48)

## [0.2.0] - 2026-02-25

### Breaking Changes

#### CLI Consolidation: 22 commands to 8
- **`uninit`** removed — use `clens init --remove`
- **`plugin`** removed — use `clens init plugin`
- **`stats`** removed — use `clens report` (default view)
- **`backtracks`** removed — use `clens report backtracks`
- **`drift`** removed — use `clens report drift`
- **`reasoning`** removed — use `clens report reasoning`
- **`tree`** removed — use `clens agents`
- **`agent`** removed — use `clens agents <id>`
- **`messages`** removed — use `clens agents --comms`
- **`decisions`**, **`edits`**, **`timeline`**, **`graph`**, **`journey`** removed — available in `clens explore` (TUI)
- Removed commands produce helpful suggestions (e.g., "'stats' was removed in v0.2.0. Did you mean 'clens report'?")
- Unknown flags now error with suggestions instead of being silently ignored

#### Renamed project from `agent-trace` to `cLens`
- CLI binary is now `clens`, hook binary is `clens-hook`, data directory is `.clens/`

### Added

#### New `report` command
- `clens report --last` — concise "what happened" summary with backtrack severity, high-risk files, top tools, agent workload
- `clens report --last backtracks` — backtrack analysis (with `--detail` for per-backtrack breakdown)
- `clens report --last drift` — plan drift analysis (with optional spec path)
- `clens report --last reasoning` — reasoning analysis (with `--full`, `--intent`)
- `clens report --last --json` — full DistilledSession JSON; `--json backtracks` for filtered output

#### Enhanced `init` command
- `clens init --remove` replaces `uninit`
- `clens init --status` shows hook count, plugin status, data stats
- `clens init plugin` absorbs all plugin management (`--remove`, `--dev`, `--status`)

#### Enhanced `agents` command
- `clens agents --last <id>` drills into a specific agent (by name, partial ID, or type)
- `clens agents --last --comms` shows communication timeline
- Solo session detection: prints "Solo session (no subagents)."

#### Flag Validation
- Unknown flags produce errors with suggestions (e.g., "Unknown flag --deep for 'report'. Did you mean 'clens distill --deep'?")

#### Deep Agent Observability
- `clens agent <id>` per-agent detail reports (tool usage, file maps, cost estimates)
- `clens graph` communication flow visualization between agents
- `clens explore` interactive TUI session explorer
- `clens distill --deep` for recursive distillation of subagent transcripts
- Active duration calculation — "29m active (10h59m wall)" in all outputs
- Agent tree building and enrichment with per-agent cost breakdown

#### Standalone Analysis Commands (now under `report`)
- Backtrack analysis with severity classification and hot file detection
- Decision point extraction (timing gaps, tool pivots, phase boundaries)
- Reasoning extraction from transcripts with intent classification
- Edit chain tracking with thinking-to-code binding
- Journey/lifecycle analysis for session progression
- Plan-to-execution drift analysis

#### Multi-Agent Pipeline
- Communication graph builder for inter-agent message flow
- Communication sequence extraction for ordered message timelines
- Cross-session aggregation for trend analysis
- Team metrics pipeline (decisions-team, summary-team)

#### Machine-Readable Output
- `--json` flag on all display commands for programmatic consumption

#### TUI Interactive Explorer
- Dynamic tab rendering: only tabs with data are shown (no empty Backtracks/Drift/Agents for solo sessions)
- Generic scroll support for all content tabs (overview, backtracks, decisions, reasoning, edits, drift, graph)
- Session list matches `clens list` layout: ID, Started, Branch, Team, Type, Distilled, Duration, Events, Status
- Terminal height-aware content clipping prevents overflow
- Keyboard shortcut hints shown per tab
- Decisions tab shows all decision points (not just 3)
- Reasoning tab shows all entries (not just last 10)
- Backtracks tab enhanced with timestamps, durations, error previews

#### Plugin System
- Agentic plugin with 5 skills, 3 slash commands, 1 agent
- `clens init plugin` for installation and management

### Fixed

#### TUI Data Pipeline
- Agent stats (tool calls, files, cost) now populated for multi-agent sessions via 3-layer fallback: time-range estimation, transcript enrichment, session event enrichment
- Active duration no longer shows "0ms active" for orchestrator sessions — falls back to wall duration
- Model detection chain extended: hook events → transcript → first agent model
- Parent session added to nameMap as "leader" — fixes full UUIDs in comm graph, messages, and graph tabs
- File map aggregation works for multi-agent sessions (edits tab no longer shows only reads)
- Token usage verified correct per Claude API semantics (input_tokens excludes cached; cache_read_input_tokens is separate)
- Agent workload in overview tab now populated from enriched agent stats

#### TUI Display
- Pluralization fix: "phase boundaries" not "phase boundarys"
- Agent lifetime bar labels truncated with ellipsis for consistent alignment
- Comm graph and messages tab truncate UUID-like names to 8 chars as fallback
- Git diff section in edits tab capped at 5 files for TUI compactness
- Token usage display shows total input with cached/uncached breakdown

#### P0: Debugging Loop Never Terminates
- Added termination conditions: 5-minute gap threshold, non-Bash interleave detection, 50-attempt cap

#### P0: Cost Estimation Is Fabricated
- Added `is_estimated` flag, display with `~` prefix and "(rough estimate)" label
- Extract real token counts from usage events when available

#### P1: Drift Score Is Broken
- Removed scalar score from `report drift` output; raw file lists (matched/unexpected/missing) are the primary signal
- Score retained in `distill` summary and TUI for at-a-glance orientation

#### P1: Path Normalization Hardcoded
- Replaced `KNOWN_ROOT_DIRS` with dynamic project-dir-based path stripping

#### P1: Active Duration Silently Inflated
- Pass raw unfiltered timing gaps separately from noise-filtered list

#### P2: Intent Classification Priority Bug
- Renamed `intent` to `intent_hint` to signal heuristic nature

#### P2: Silent Error Swallowing
- Added `.clens/errors.log` logging with timestamp and context

### Changed

#### Code Quality
- Readonly types throughout all type definitions and function signatures
- Type guards for runtime validation of parsed data
- Immutable patterns enforced: no `let`, no `.push()`, no loops — all new code uses `flatMap`/`reduce`/`filter().map()`
- 1086 tests across 48 test files

## [0.1.0] - 2026-02-20

### Added
- Session capture via Claude Code hooks (14 event types, JSONL format)
- Distill pipeline with 9 extractors: stats, backtracks, decisions, file-map, git-diff, reasoning, user-messages, summary, timeline
- Multi-agent session support via `_links.jsonl` cross-agent linking
- CLI commands: `init`, `uninit`, `list`, `stats`, `distill`, `clean`, `export`, `tree`, `messages`
- Transcript parser for reasoning extraction and user message analysis
- Hook proxy system for delegating to existing user hooks
- Session context enrichment (git branch, commit, team, worktree)
- Cost estimation (token heuristic + model pricing)
- Zero-dependency, local-first architecture
- Compiled binary support via `bun build --compile`
