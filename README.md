# cLens — Session Observability for Claude Code

[![npm](https://img.shields.io/npm/v/@silou/clens)](https://www.npmjs.com/package/@silou/clens)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1086%20passing-brightgreen)]()

**Local-first session capture and analysis for Claude Code agents.** See what your agent actually did — every tool call, backtrack, decision, and reasoning step — without any network dependencies.

## What it does

cLens hooks into Claude Code to capture complete session traces as local JSONL files. Every tool call, session lifecycle event, and agent message is appended to a flat file in your project — no network, no server, no external dependencies. After a session, the `distill` command runs 23 extractors to surface decision points, backtracks, reasoning patterns, edit chains, plan drift, multi-agent communication, and more for post-hoc analysis.

### Key capabilities

- **Session capture** — zero-config hooks, ~2ms overhead per event
- **Backtrack detection** — find where agents reversed course and why
- **Decision analysis** — trace decision points through agent reasoning
- **Edit chains** — link thinking blocks to the code changes they produced
- **Plan drift** — compare intended spec vs actual execution
- **Multi-agent tracing** — communication graphs, team metrics, agent trees
- **Interactive TUI** — explore sessions with keyboard-navigable tabs
- **OpenTelemetry export** — bridge to existing observability stacks

## Prerequisites

[Bun](https://bun.sh) >= 1.0

## Quick Start

```sh
npm install -g clens       # or: bun install -g clens
```

Then in any project:

```sh
clens init                          # install hooks
# use Claude Code normally
clens list                          # see captured sessions
clens distill --last                # analyze latest session
clens report --last                 # what happened? (summary)
clens report --last backtracks      # drill into backtracks
clens agents --last                 # agent overview
clens explore                       # interactive TUI explorer
```

## CLI Reference

### Setup

| Command | Description |
|---|---|
| `init` | Install hooks into `.claude/settings.json` |
| `init --remove` | Remove hooks, restore original settings |
| `init --status` | Show installation status (hooks, plugin, data) |
| `init plugin` | Install agentic plugin into `~/.claude/` |
| `init plugin --remove` | Remove agentic plugin |
| `init plugin --dev` | Dev mode (symlink from source) |

### Sessions

| Command | Description |
|---|---|
| `list` | List captured sessions with duration, events, team, type, status |
| `distill [id]` | Extract insights: backtracks, decisions, file map, reasoning, edit chains |
| `report [id]` | Session summary -- backtrack severity, high-risk files, top tools |
| `report [id] backtracks` | Backtrack analysis (add `--detail` for per-backtrack breakdown) |
| `report [id] drift [spec]` | Plan drift analysis (spec vs actual files) |
| `report [id] reasoning` | Reasoning analysis (add `--full` for full text, `--intent` to filter) |
| `agents [id]` | Agent table overview (or `agents [id] <agent>` for detail) |
| `agents [id] --comms` | Communication timeline |
| `explore` | Interactive TUI explorer (dynamic tabs, scroll, keyboard nav) |

### Data

| Command | Description |
|---|---|
| `clean [id]` | Remove raw session data (preserves distilled artifacts) |
| `export [id]` | Export session as archive (supports `--otel` for OTLP format) |

## Flags

| Flag | Applies to | Description |
|---|---|---|
| `--last` | Most commands | Use most recent session |
| `--json` | Analysis commands | Output structured JSON |
| `--all` | `distill`, `clean` | Apply to all sessions |
| `--deep` | `distill` | Enrich agents with transcript data |
| `--force` | `clean` | Skip safety checks |
| `--detail` | `report backtracks` | Per-backtrack breakdown |
| `--full` | `report reasoning` | Show full thinking text |
| `--intent <type>` | `report reasoning` | Filter by intent type |
| `--comms` | `agents` | Show communication timeline |
| `--otel` | `export` | Export in OTLP format |
| `--remove` | `init` | Remove hooks/plugin |
| `--status` | `init` | Show installation status |
| `--dev` | `init plugin` | Dev mode (symlink from source) |

## Why cLens

| | cLens | OTel-based tools | Usage trackers | Session viewers |
|---|---|---|---|---|
| Capture method | Native hooks (2ms) | Proxy/middleware | Log parsing | Transcript reading |
| Backtrack detection | 23 extractors | -- | -- | -- |
| Decision analysis | Built-in | -- | -- | -- |
| Edit chain tracking | Built-in | -- | -- | -- |
| Plan drift analysis | Built-in | -- | -- | -- |
| Multi-agent support | Full (comms, trees) | Partial | -- | -- |
| Network required | No | Yes | No | No |
| Interactive explorer | TUI | Dashboard | -- | Web UI |
| Self-analysis plugin | Yes (agents analyze own sessions) | -- | -- | -- |

## How it works

Two-layer architecture:

**Layer 1 -- Hooks**: Claude Code fires hooks on every tool call, session start/end, and agent lifecycle event. cLens registers a compiled binary as the hook handler. Each invocation appends a structured event to a JSONL file under `.clens/sessions/`. Target: ~2ms per invocation.

**Layer 2 -- Transcript Enrichment**: At distill time, the Claude Code transcript is parsed for thinking blocks and user messages, providing context for why the agent made the choices it did.

The `distill` command runs 23 extractors covering: stats, backtracks, decisions, file-map, git-diff, reasoning, user-messages, summary, timeline, plan-drift, edit-chains, active-duration, aggregate, comm-graph, comm-sequence, agent-tree, agent-distill, agent-enrich, team, decisions-team, summary-team, journey, and agent-lifetimes. Output is written as structured JSON to `.clens/distilled/`.

## Agentic Plugin

cLens ships an agentic plugin that integrates directly into Claude Code, giving agents the ability to analyze their own sessions.

```sh
clens init plugin          # install into ~/.claude/
clens init plugin --dev    # dev mode (symlink from source)
clens init plugin --status # check installation state
```

The plugin provides:

- **5 skills**: session-analysis, session-report, session-compare, backtrack-analysis, journey-report
- **3 slash commands**: `/session-report`, `/session-compare`, `/backtrack-analysis`
- **1 agent**: session-analyst

## Session data

```
.clens/
  sessions/    Raw JSONL event files (one per session)
  distilled/   Analyzed JSON output from distill
  exports/     Archived session bundles
```

## Privacy

All data is local. No network calls. No telemetry. Full tool call payloads -- including arguments and outputs -- are written to JSONL. Be aware of this if sessions involve credentials, API keys, or sensitive file contents.

## Development

```sh
bun test          # 1086 tests across 48 files
bun run typecheck
bun run build
```
