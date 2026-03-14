import {
	createMemo,
	createSignal,
	For,
	Show,
	type Component,
} from "solid-js";
import { Files } from "lucide-solid";
import type { DistilledSession } from "../../../shared/types";
import { SessionSnapshot } from "../SessionSnapshot";
import { NarrativeSection } from "../NarrativeSection";
import { AgentWorkloadTable } from "../AgentWorkloadTable";
import { IssuesPanel } from "../IssuesPanel";
import { ThinkingBreakdown } from "../ThinkingBreakdown";
import { PlanDriftSection } from "../PlanDriftSection";
import { FileList, buildFileRows } from "../FileList";
import { BottomPanel } from "../BottomPanel";

// -- Types ----------------------------------------------------------------

type OverviewPanelProps = {
	readonly session: DistilledSession;
	readonly sessionId: string;
	readonly isMultiAgent: boolean;
};

type TabId = "overview" | "backtracks" | "timeline" | "edits" | "comms";

type TabDef = {
	readonly id: TabId;
	readonly label: string;
	readonly count: () => number;
	readonly visible: boolean;
};

// -- File list card wrapper -----------------------------------------------

const FileListCard: Component<{
	readonly session: DistilledSession;
}> = (props) => {
	const fileRows = createMemo(() => buildFileRows(props.session));
	const totalAdditions = createMemo(() =>
		fileRows().reduce((sum, f) => sum + f.additions, 0),
	);
	const totalDeletions = createMemo(() =>
		fileRows().reduce((sum, f) => sum + f.deletions, 0),
	);

	return (
		<div class="animate-fade-in rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
			<div class="flex items-center gap-3 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
				<Files class="h-4 w-4 text-emerald-500" />
				<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
					Modified Files
				</h3>
				<Show when={totalAdditions() > 0}>
					<span class="text-xs text-emerald-500">+{totalAdditions()}</span>
				</Show>
				<Show when={totalDeletions() > 0}>
					<span class="text-xs text-red-500">-{totalDeletions()}</span>
				</Show>
			</div>
			<FileList rows={fileRows()} />
		</div>
	);
};

// -- Overview content (cards) ---------------------------------------------

const OverviewContent: Component<OverviewPanelProps> = (props) => (
	<div class="space-y-3">
		{/* 1. Session Snapshot */}
		<SessionSnapshot session={props.session} />

		{/* 2. Narrative */}
		<Show when={props.session.summary?.narrative}>
			<NarrativeSection session={props.session} />
		</Show>

		{/* 3. Agent Workload (multi-agent only) */}
		<Show when={props.isMultiAgent}>
			<AgentWorkloadTable
				session={props.session}
				sessionId={props.sessionId}
			/>
		</Show>

		{/* 4. Issues & Errors */}
		<IssuesPanel session={props.session} />

		{/* 5. Thinking Breakdown */}
		<Show when={props.session.reasoning.length > 0}>
			<ThinkingBreakdown session={props.session} />
		</Show>

		{/* 6. Modified Files */}
		<FileListCard session={props.session} />

		{/* 7. Plan Drift */}
		<Show when={props.session.plan_drift}>
			<PlanDriftSection session={props.session} />
		</Show>
	</div>
);

// -- Tab badge component --------------------------------------------------

const TabBadge: Component<{
	readonly count: number;
	readonly isBacktrack?: boolean;
}> = (props) => (
	<Show when={props.count > 0}>
		<span
			class="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
			classList={{
				"bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400": props.isBacktrack === true && props.count > 0,
				"bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400": props.isBacktrack !== true,
			}}
		>
			{props.count}
		</span>
	</Show>
);

// -- Main component -------------------------------------------------------

export const OverviewPanel: Component<OverviewPanelProps> = (props) => {
	const [activeTab, setActiveTab] = createSignal<TabId>("overview");

	// Tab definitions with counts
	const tabs = createMemo((): readonly TabDef[] => [
		{
			id: "overview" as const,
			label: "Overview",
			count: () => 0,
			visible: true,
		},
		{
			id: "backtracks" as const,
			label: "Backtracks",
			count: () => props.session.backtracks.length,
			visible: true,
		},
		{
			id: "timeline" as const,
			label: "Timeline",
			count: () => props.session.timeline?.length ?? 0,
			visible: (props.session.timeline?.length ?? 0) > 0,
		},
		{
			id: "edits" as const,
			label: "Edits",
			count: () => props.session.edit_chains?.chains.length ?? 0,
			visible: (props.session.edit_chains?.chains.length ?? 0) > 0,
		},
		{
			id: "comms" as const,
			label: "Communication",
			count: () => props.session.comm_sequence?.length ?? 0,
			visible: props.isMultiAgent,
		},
	]);

	const visibleTabs = createMemo(() => tabs().filter((t) => t.visible));

	return (
		<div class="flex h-full flex-col overflow-hidden">
			{/* Horizontal tab bar */}
			<div class="flex items-center border-b border-gray-200 bg-gray-50 px-2 dark:border-gray-800 dark:bg-gray-900/50">
				<For each={visibleTabs()}>
					{(tab) => (
						<button
							onClick={() => setActiveTab(tab.id)}
							class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition border-b-2"
							classList={{
								"border-blue-500 text-blue-600 dark:text-blue-400": activeTab() === tab.id,
								"border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300": activeTab() !== tab.id,
							}}
						>
							{tab.label}
							<TabBadge count={tab.count()} isBacktrack={tab.id === "backtracks"} />
						</button>
					)}
				</For>
			</div>

			{/* Tab content */}
			<div class="flex-1 overflow-y-auto">
				<Show when={activeTab() === "overview"}>
					<div class="p-3">
						<OverviewContent
							session={props.session}
							sessionId={props.sessionId}
							isMultiAgent={props.isMultiAgent}
						/>
					</div>
				</Show>
				<Show when={activeTab() !== "overview"}>
					<BottomPanel
						session={props.session}
						isMultiAgent={props.isMultiAgent}
						activeTab={activeTab() as "backtracks" | "timeline" | "edits" | "comms"}
					/>
				</Show>
			</div>
		</div>
	);
};
