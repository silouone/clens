/** Agent type badge color classes (shared between AgentTree and AgentWorkloadTable). */
export const TYPE_COLORS: Readonly<Record<string, string>> = {
	"general-purpose": "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-400",
	builder: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-400",
	validator: "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-400",
	Explore: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-400",
	Plan: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-400",
	leader: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-400",
};

export const getTypeBadgeClass = (agentType: string): string =>
	TYPE_COLORS[agentType] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400";
