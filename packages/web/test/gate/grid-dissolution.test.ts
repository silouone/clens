import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	ARCHIVED_WIDGETS,
	anyOverviewWidgetShown,
	OVERVIEW_WIDGET_IDS,
	shown,
} from "../../src/client/lib/archived-widgets";

// ── Grid-dissolution gate (session-detail-v6, slice #3) ──────────────
//
// The widget election dissolved the Overview bento grid behind ONE reversible
// flag: `ARCHIVED_WIDGETS` in lib/archived-widgets.ts. This gate locks the
// mechanism from both ends:
//   1. the pure flag module (importable under bun — no window): every widget
//      id is archived, the predicate hides each one, and the grid container
//      predicate is false; deleting one id RESTORES that card (reversibility).
//   2. source pins on OverviewPanel.tsx: every widget render site is gated by
//      its `shown("w_<id>")` guard and the DashboardGrid container is gated by
//      `anyOverviewWidgetShown()`. Solid components can't be unit-imported
//      under bun (they transitively touch `window` at module load), so we pin
//      the load-bearing source lines — the same pattern as the design-token
//      and state-wiring gates.
//   3. nothing deleted: all 12 widget modules exist on disk, the barrel still
//      exports them, and the panel still imports them — one-flag restore.

const CLIENT = resolve(import.meta.dir, "../../src/client");
const read = (rel: string) => readFileSync(resolve(CLIENT, rel), "utf-8");

/** Election verdict: the twelve archived Overview widget ids, verbatim. */
const ELECTED_IDS = [
	"w_activity",
	"w_agents",
	"w_context",
	"w_cost",
	"w_edits",
	"w_files",
	"w_outcome",
	"w_risk",
	"w_taskplan",
	"w_reasoning",
	"w_config",
	"w_harness",
] as const;

/** Widget id → component name + module file (restorability surface). */
const WIDGETS: ReadonlyArray<{ id: string; component: string; file: string }> = [
	{ id: "w_activity", component: "ActivityWidget", file: "ActivityWidget.tsx" },
	{ id: "w_agents", component: "AgentsWidget", file: "AgentsWidget.tsx" },
	{ id: "w_context", component: "ContextWidget", file: "ContextWidget.tsx" },
	{ id: "w_cost", component: "CostWidget", file: "CostWidget.tsx" },
	{ id: "w_edits", component: "EditsWidget", file: "EditsWidget.tsx" },
	{ id: "w_files", component: "FilesWidget", file: "FilesWidget.tsx" },
	{ id: "w_outcome", component: "OutcomeWidget", file: "OutcomeWidget.tsx" },
	{ id: "w_risk", component: "RiskWidget", file: "RiskWidget.tsx" },
	{ id: "w_taskplan", component: "TaskPlanWidget", file: "TaskPlanWidget.tsx" },
	{ id: "w_reasoning", component: "ReasoningWidget", file: "ReasoningWidget.tsx" },
	{ id: "w_config", component: "ConfigWidget", file: "ConfigWidget.tsx" },
	{ id: "w_harness", component: "HarnessFeaturesWidget", file: "HarnessFeaturesWidget.tsx" },
];

describe("archive flag: all twelve widgets archived (grid dissolved)", () => {
	test("the id universe matches the election verdict exactly", () => {
		expect([...OVERVIEW_WIDGET_IDS].sort()).toEqual([...ELECTED_IDS].sort());
	});

	test("every elected id is in ARCHIVED_WIDGETS", () => {
		const missing = ELECTED_IDS.filter((id) => !ARCHIVED_WIDGETS.has(id));
		expect(missing).toEqual([]);
	});

	test("shown() is false for every widget id", () => {
		const visible = OVERVIEW_WIDGET_IDS.filter((id) => shown(id));
		expect(visible).toEqual([]);
	});

	test("the grid-container predicate is false while everything is archived", () => {
		expect(anyOverviewWidgetShown()).toBe(false);
	});
});

describe("archive flag: un-archiving one id restores its card (reversibility)", () => {
	test("deleting an id flips shown() true and re-materializes the grid container", () => {
		expect(shown("w_cost")).toBe(false);
		ARCHIVED_WIDGETS.delete("w_cost");
		try {
			expect(shown("w_cost")).toBe(true);
			expect(anyOverviewWidgetShown()).toBe(true);
			// Restoring ONE card never leaks the others.
			expect(shown("w_risk")).toBe(false);
			expect(shown("w_edits")).toBe(false);
		} finally {
			ARCHIVED_WIDGETS.add("w_cost");
		}
		// The archive is intact again after the probe (guard bites both ways).
		expect(shown("w_cost")).toBe(false);
		expect(anyOverviewWidgetShown()).toBe(false);
	});
});

describe("render wiring: OverviewPanel gates every widget through the flag", () => {
	const panel = read("components/panels/OverviewPanel.tsx");

	test('each widget render site sits inside its own shown("w_<id>") guard', () => {
		for (const { id, component } of WIDGETS) {
			const guard = panel.indexOf(`shown("${id}")`);
			expect(guard, `no shown("${id}") guard in OverviewPanel`).toBeGreaterThanOrEqual(0);
			// The component must render within the guarded <Show> block.
			const blockEnd = panel.indexOf("</Show>", guard);
			const block = panel.slice(guard, blockEnd);
			expect(
				block.includes(`<${component}`),
				`<${component}> is not inside its shown("${id}") block`,
			).toBe(true);
		}
	});

	test("no widget renders outside a shown() guard (12 guards, 12 render sites)", () => {
		const guards = panel.match(/shown\("w_[a-z]+"\)/g) ?? [];
		expect(new Set(guards).size).toBe(12);
		for (const { component } of WIDGETS) {
			const renders = panel.match(new RegExp(`<${component}[\\s/>]`, "g")) ?? [];
			expect(renders.length, `<${component}> must render exactly once`).toBe(1);
		}
	});

	test("the grid container itself is gated by anyOverviewWidgetShown()", () => {
		const gate = panel.indexOf("<Show when={anyOverviewWidgetShown()}>");
		const grid = panel.indexOf("<DashboardGrid>");
		expect(gate).toBeGreaterThanOrEqual(0);
		expect(grid).toBeGreaterThan(gate);
		// The grid closes before the gating Show does — it is INSIDE the gate.
		const gridClose = panel.indexOf("</DashboardGrid>", grid);
		const gateClose = panel.indexOf("</Show>", gridClose);
		expect(gridClose).toBeGreaterThan(grid);
		expect(gateClose).toBeGreaterThan(gridClose);
	});
});

describe("nothing deleted: every widget stays code-present and one-flag restorable", () => {
	const barrel = read("components/overview/widgets/index.ts");
	const panel = read("components/panels/OverviewPanel.tsx");

	test("all 12 widget modules still exist on disk", () => {
		const missing = WIDGETS.filter(
			(w) => !existsSync(resolve(CLIENT, "components/overview/widgets", w.file)),
		);
		expect(missing.map((w) => w.file)).toEqual([]);
	});

	test("the widget barrel still exports all 12 components", () => {
		for (const { component } of WIDGETS) {
			expect(barrel).toContain(`export { ${component} }`);
		}
	});

	test("OverviewPanel still imports all 12 components (restore = delete one id)", () => {
		for (const { component } of WIDGETS) {
			expect(panel).toContain(component);
		}
	});
});
