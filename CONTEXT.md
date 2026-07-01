# cLens

Local-first observability over Claude Code agent sessions. The domain is not "viewing traces" — it is **closing a feedback loop on one's own agentic practice**: observe what agents did, extract actionable feedback, and change the Agentic Setup so better pathways get chosen next time.

## Language

**Agentic Setup**:
The corpus a practitioner tunes to shape how their LLM behaves — skills, rules (CLAUDE.md), hooks, agents, and prompts. The *thing being changed* at the end of the loop.
_Avoid_: config, settings, environment

**Pathway**:
The route an LLM actually takes through a task (which tools, which order, which decisions). Tuning the Agentic Setup aims to bias the model toward *correct* pathways.
_Avoid_: path, route, trajectory

**Feedback**:
The actionable output cLens exists to produce — a specific, named change a practitioner could make to their Agentic Setup (add a skill, write a rule, adjust a hook, reword a prompt). Distinct from passively-observed data: feedback provokes an action; data just sits.
_Avoid_: insight, metric, analytics, report

**Practice**:
A practitioner's ongoing body of agentic engineering across many sessions — the subject of the high-level, aggregate feedback loop. Per-session feedback rolls up into Practice-level feedback.
_Avoid_: workflow, usage, history

**Session**:
One captured Claude Code run, from start to end. Lives in two stances: **live** (currently operating, watched as it happens) and **post-hoc** (complete, analyzed after the fact). Both must yield Feedback.
_Avoid_: trace, run, log

**Smart/Dumb Zone**:
The quality regime of a context window. Even at 1M tokens, agent quality degrades past a threshold (~150–250k observed) — the "dumb zone." Detecting the crossing is what justifies session-hygiene Feedback (e.g. "clear sooner").
_Avoid_: context limit, window full, overflow

**Sweet Spot**:
The optimum a practitioner is steering toward when objectives compete — context quality vs. cost vs. cached-token reuse vs. wall-time vs. how much manual human steering a session demands. Much Feedback is a recommendation about where the Sweet Spot lies.
_Avoid_: balance, tradeoff, optimization
