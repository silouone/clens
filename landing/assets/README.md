# landing/assets — marketing screenshots

Static image assets for the clens.dev landing page. These files live inside the
landing site root so the deployed Cloudflare Pages bundle is self-contained
(a deployed static site cannot reach `../.github/assets/`). The canonical
capture location is `../.github/assets/`; these are the gate-cleared copies.

## Screenshot gate (LAND-4)

> **Screenshot capture must start only after the FE credibility fixes and the
> Work Units cut have landed.** A capture taken before them bakes
> credibility-killers (internal "Fable" codename on Model Breakdown, a
> "Quality Score 0/100" headline, the Work Units surface) into the OG image and
> feature section.

### Source-fix gate: CLEARED (verified 2026-06-27)

| Gate | Fix | Evidence (working tree) |
|---|---|---|
| **NUM-6** — internal codename "Fable" | Raw model ids humanized for display | `packages/web/src/client/lib/format.ts` — `humanizeModelId` maps `claude-fable-5` → display name; used by `pages/UsagePage.tsx` Model Breakdown. |
| **NUM-9** — "Quality Score" headline | Quality Score **cut** for launch (DECISIONS D3) | `packages/web/src/server/routes/analytics.ts` + `pages/InsightsPage.tsx` — headline, `agent_quality_score` field, and dead second implementation removed. |
| **FE-1** — Work Units | Work Units surface **cut** | No live source references under `packages/web/src` / `packages/cli/src` (only historical `.clens` session logs). |

### Per-image visual verification (each PNG opened and inspected)

The source fix landing is necessary but not sufficient — what renders depends on
the dogfooded session. Each candidate was opened and checked against the gate:

| File | Fable? | Quality Score? | Work Units? | Verdict |
|---|---|---|---|---|
| `dashboard-detail.png` | no (model = Opus 4.8) | no headline | no | **clean — ship** |
| `dashboard-insights.png` | no | no | no | **clean — ship** |
| `dashboard-sessions.png` | no | no | no | ship with caveat ¹ |
| `dashboard-sessions-light.png` | no | no | no | ship with caveat ¹ |
| `dashboard-mobile.png` | no | no | no | ship with caveat ¹ |
| ~~`dashboard-usage.png`~~ | **YES — "CLAUDE FABLE 5"** | no | no | **REMOVED — fails NUM-6** ² |

¹ **Caveat (outside LAND-4's three gates, do not bury):** the SESSIONS header on
all three sessions shots shows a cumulative `SPAN 22051h` (~22k h) KPI — the same
credibility-killer class landing.md §1.5 flags ("TOTAL TIME 22245h"). It is a
time-aggregation issue (NUM-time), not one of LAND-4's three gates, so these are
not blocked here — but they should NOT be certified fully credibility-clean for
the hero/OG until that KPI is fixed or excluded from the crop. Surface to Silou.

² **`dashboard-usage.png` removed.** NUM-6 humanizes the id but the output still
contains the word "Fable" ("Claude Fable 5" in Model Breakdown), and the honesty
gate (_positioning-synthesis §4 / §3.7) bars the codename "Fable" from any public
**screenshot**, humanized or not. The dogfooded session used the `claude-fable-5`
model. To use a usage/model-breakdown shot, re-capture from a session that did
not touch that model (or after a public-name relabel lands).

## Files + alt text (gate-cleared set)

Reference these from `index.html` with the alt text below (honesty-safe: cost is
"estimated", no overclaims).

| File | Used as | Alt text |
|---|---|---|
| `dashboard-detail.png` | Hero / feature: decision trace | "cLens session detail — agent timeline with backtracks, decision points, and reasoning trace; cost shown is estimated." |
| `dashboard-insights.png` | Feature: cross-session analytics | "cLens insights — cross-session analytics including backtrack rate, edit survival, and plan-drift." |
| `dashboard-sessions.png` | Sessions list (dark) | "cLens dashboard session list — local Claude Code sessions with status, span, events, and agents." |
| `dashboard-sessions-light.png` | Light-mode variant | "cLens dashboard session list in light mode." |
| `dashboard-mobile.png` | Responsive proof | "cLens dashboard on a mobile viewport, reflowed to a single column." |

## Re-capture / refresh

1. Confirm the source-fix gate table above still holds in the working tree.
2. Run the dashboard against a real dogfooded session — for the usage/model
   shot, one that did **not** use the `claude-fable-5` model.
3. Capture into `../.github/assets/` (canonical), then copy the gate-cleared
   files here. Keep filenames identical so `index.html` references stay valid.
4. Re-open each PNG and re-run the visual verification table before shipping.
