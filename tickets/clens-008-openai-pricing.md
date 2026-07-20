---
id: clens-008-openai-pricing
type: feat
status: in-review
priority: 2
created: 2026-07-20
caps: { minutes: 30, turns: 150 }
attempts: []
---
# OpenAI / gpt-5.x pricing + context windows

Codex sessions imported by clens-007 land their model slug on
`SessionStart.context.model` (e.g. `gpt-5.6-sol`), which `extractModel` reads
first for pricing. The pricing/context tables in `packages/cli/src/distill/
stats.ts` only know Claude ids, so a Codex session prices at $0.

## Task
Add gpt-5.x-class ids to `API_PRICING` + `MODEL_CONTEXT_WINDOWS` (longest-prefix
match, so `gpt-5.6-sol` resolves via a `gpt-5` family fallback). No structural
change. Codex usage has no cache-write analog, so `cache_write` is set to the
same shape as other entries but is never exercised (cache_creation_tokens = 0
from the importer). Note the rates' provenance in a comment; leave
`PRICING_VERSION` semantics intact.

## Gate
`bun run typecheck && bun run lint && bun test`
