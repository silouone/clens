import {
	Activity,
	AlertTriangle,
	Database,
	DollarSign,
	GitBranch,
	MessageSquare,
	Pencil,
	Users,
} from "lucide-solid";
import type { Component } from "solid-js";

// ── Detail-view tab ids ──────────────────────────────────────────────
//
// The session-detail surface has five tabs. Lifted here (out of OverviewPanel)
// so the category → click-through `targetTab` and the widget/tab prop contracts
// share one definition.

export type DetailTabId = "overview" | "backtracks" | "timeline" | "edits" | "comms";

// ── Semantic category channels (overview-moat-refactor) ──────────────
//
// THE single source of truth for the eight signal categories. Each maps to:
//   • cssVar    — the additive `--clens-cat-*` token (for inline SVG strokes,
//                 LED dots, and dynamic colors a Tailwind class can't express).
//   • ruleClass — the SANCTIONED colored left-rule idiom as a LITERAL Tailwind
//                 arbitrary class so the JIT scanner emits it (constraint C2;
//                 `shadow-[inset_2px_0_0_0_var(...)]` is explicitly allowed by
//                 the idiom gate — it is NOT a banned drop shadow).
//   • textClass — the mapped `text-cat-*` utility (see tailwind.config.js).
//   • label     — microcaps channel label.
//   • icon      — lucide channel glyph.
//   • targetTab — where a click-through on a widget of this channel jumps.

export type CategoryKey =
	| "timing"
	| "cost"
	| "risk"
	| "context"
	| "outcome"
	| "edits"
	| "comms"
	| "agents";

export type CategoryMeta = {
	readonly key: CategoryKey;
	readonly cssVar: string;
	readonly ruleClass: string;
	readonly textClass: string;
	readonly label: string;
	readonly icon: Component<{ readonly class?: string }>;
	readonly targetTab?: DetailTabId;
};

export const CATEGORY: Readonly<Record<CategoryKey, CategoryMeta>> = {
	timing: {
		key: "timing",
		cssVar: "var(--clens-cat-timing)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-timing)]",
		textClass: "text-cat-timing",
		label: "Timing",
		icon: Activity,
		targetTab: "timeline",
	},
	cost: {
		key: "cost",
		cssVar: "var(--clens-cat-cost)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-cost)]",
		textClass: "text-cat-cost",
		label: "Cost",
		icon: DollarSign,
	},
	risk: {
		key: "risk",
		cssVar: "var(--clens-cat-risk)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-risk)]",
		textClass: "text-cat-risk",
		label: "Risk",
		icon: AlertTriangle,
		targetTab: "backtracks",
	},
	context: {
		key: "context",
		cssVar: "var(--clens-cat-context)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-context)]",
		textClass: "text-cat-context",
		label: "Context",
		icon: Database,
	},
	outcome: {
		key: "outcome",
		cssVar: "var(--clens-cat-outcome)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-outcome)]",
		textClass: "text-cat-outcome",
		label: "Outcome",
		icon: GitBranch,
	},
	edits: {
		key: "edits",
		cssVar: "var(--clens-cat-edits)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-edits)]",
		textClass: "text-cat-edits",
		label: "Edits",
		icon: Pencil,
		targetTab: "edits",
	},
	comms: {
		key: "comms",
		cssVar: "var(--clens-cat-comms)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-comms)]",
		textClass: "text-cat-comms",
		label: "Communication",
		icon: MessageSquare,
		targetTab: "comms",
	},
	agents: {
		key: "agents",
		cssVar: "var(--clens-cat-agents)",
		ruleClass: "shadow-[inset_2px_0_0_0_var(--clens-cat-agents)]",
		textClass: "text-cat-agents",
		label: "Agents",
		icon: Users,
		targetTab: "comms",
	},
} as const;
