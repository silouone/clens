import type { WorkUnit } from "../../shared/types";

export const LIFECYCLE_LABELS: Readonly<Record<WorkUnit["lifecycle"], string>> = {
	"prime-plan-build": "Prime > Plan > Build",
	"prime-build": "Prime > Build",
	"plan-build": "Plan > Build",
	"plan-build-review": "Plan > Build > Review",
	"multi-build": "Multi-Build",
	"ad-hoc": "Ad-hoc",
} as const;

export const LIFECYCLE_COLORS: Readonly<Record<WorkUnit["lifecycle"], string>> = {
	"prime-plan-build": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
	"prime-build": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
	"plan-build": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
	"plan-build-review": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
	"multi-build": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
	"ad-hoc": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
} as const;

export const PHASE_COLORS: Readonly<Record<string, string>> = {
	prime: "bg-violet-400 dark:bg-violet-500",
	plan: "bg-amber-400 dark:bg-amber-500",
	build: "bg-emerald-400 dark:bg-emerald-500",
	review: "bg-blue-400 dark:bg-blue-500",
	other: "bg-gray-400 dark:bg-gray-500",
} as const;
