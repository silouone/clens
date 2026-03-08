import { createMemo, For, Show, type Component } from "solid-js";
import type { PlanDriftReport } from "../../shared/types";

// ── Types ───────────────────────────────────────────────────────────

type PlanDriftViewProps = {
	readonly planDrift: PlanDriftReport;
};

type FileStatus = "match" | "missing" | "unexpected";

type FileItem = {
	readonly path: string;
	readonly status: FileStatus;
};

// ── Helpers ─────────────────────────────────────────────────────────

const statusConfig: Record<FileStatus, { label: string; cls: string; dotCls: string }> = {
	match: {
		label: "Match",
		cls: "text-emerald-400",
		dotCls: "bg-emerald-500",
	},
	missing: {
		label: "Missing",
		cls: "text-red-400",
		dotCls: "bg-red-500",
	},
	unexpected: {
		label: "Unexpected",
		cls: "text-amber-400",
		dotCls: "bg-amber-500",
	},
};

const buildFileItems = (drift: PlanDriftReport): readonly FileItem[] => {
	const missingSet = new Set(drift.missing_files);
	const unexpectedSet = new Set(drift.unexpected_files);
	const allPaths = new Set([
		...drift.expected_files,
		...drift.actual_files,
	]);

	return [...allPaths]
		.sort((a, b) => a.localeCompare(b))
		.map((path): FileItem => {
			if (missingSet.has(path)) return { path, status: "missing" };
			if (unexpectedSet.has(path)) return { path, status: "unexpected" };
			return { path, status: "match" };
		});
};

const driftScoreColor = (score: number): string => {
	if (score <= 0.2) return "text-emerald-400";
	if (score <= 0.5) return "text-amber-400";
	return "text-red-400";
};

const driftScoreLabel = (score: number): string => {
	if (score <= 0.2) return "Low drift";
	if (score <= 0.5) return "Moderate drift";
	return "High drift";
};

// ── Component ───────────────────────────────────────────────────────

export const PlanDriftView: Component<PlanDriftViewProps> = (props) => {
	const items = createMemo(() => buildFileItems(props.planDrift));
	const matchCount = createMemo(() => items().filter((i) => i.status === "match").length);
	const missingCount = createMemo(() => items().filter((i) => i.status === "missing").length);
	const unexpectedCount = createMemo(() => items().filter((i) => i.status === "unexpected").length);
	const driftPct = createMemo(() => Math.round(props.planDrift.drift_score * 100));

	return (
		<div class="flex h-full flex-col overflow-hidden">
			{/* Header */}
			<div class="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
				<div class="flex items-center gap-3">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Plan Drift</h2>
					<span class="font-mono text-xs text-gray-500">{props.planDrift.spec_path}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class={`text-lg font-bold ${driftScoreColor(props.planDrift.drift_score)}`}>
						{driftPct()}%
					</span>
					<span class={`text-xs ${driftScoreColor(props.planDrift.drift_score)}`}>
						{driftScoreLabel(props.planDrift.drift_score)}
					</span>
				</div>
			</div>

			{/* Summary stats */}
			<div class="flex gap-6 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
				<div class="flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full bg-emerald-500" />
					<span class="text-xs text-gray-500">{matchCount()} matched</span>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full bg-red-500" />
					<span class="text-xs text-gray-500">{missingCount()} missing</span>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full bg-amber-500" />
					<span class="text-xs text-gray-500">{unexpectedCount()} unexpected</span>
				</div>
			</div>

			{/* Two-column layout */}
			<div class="flex flex-1 overflow-hidden">
				{/* Expected files */}
				<div class="flex-1 border-r border-gray-200 dark:border-gray-800">
					<div class="border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
						<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
							Expected ({props.planDrift.expected_files.length})
						</h3>
					</div>
					<div class="overflow-y-auto p-2">
						<For each={props.planDrift.expected_files}>
							{(file) => {
								const isMissing = () => props.planDrift.missing_files.includes(file);
								const cfg = () => statusConfig[isMissing() ? "missing" : "match"];
								return (
									<div class="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50">
										<span class={`h-2 w-2 rounded-full ${cfg().dotCls}`} />
										<span
											class={`flex-1 truncate font-mono text-xs ${isMissing() ? "line-through text-gray-500" : "text-gray-700 dark:text-gray-300"}`}
										>
											{file}
										</span>
										<Show when={isMissing()}>
											<span class="text-[10px] text-red-400">missing</span>
										</Show>
									</div>
								);
							}}
						</For>
					</div>
				</div>

				{/* Actual files */}
				<div class="flex-1">
					<div class="border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
						<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
							Actual ({props.planDrift.actual_files.length})
						</h3>
					</div>
					<div class="overflow-y-auto p-2">
						<For each={props.planDrift.actual_files}>
							{(file) => {
								const isUnexpected = () => props.planDrift.unexpected_files.includes(file);
								const cfg = () => statusConfig[isUnexpected() ? "unexpected" : "match"];
								return (
									<div class="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50">
										<span class={`h-2 w-2 rounded-full ${cfg().dotCls}`} />
										<span class="flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300">
											{file}
										</span>
										<Show when={isUnexpected()}>
											<span class="text-[10px] text-amber-400">unexpected</span>
										</Show>
									</div>
								);
							}}
						</For>
					</div>
				</div>
			</div>
		</div>
	);
};
