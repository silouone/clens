import {
	createMemo,
	createSignal,
	For,
	Show,
	type Component,
} from "solid-js";
import { Files } from "lucide-solid";
import type { DistilledSession } from "../../../shared/types";
import { SessionOverview } from "../SessionOverview";
import { ConfigEnvironment } from "../ConfigEnvironment";
import { NarrativeSection } from "../NarrativeSection";
import { IssuesPanel } from "../IssuesPanel";
import { ThinkingBreakdown } from "../ThinkingBreakdown";
import { PlanDriftSection } from "../PlanDriftSection";
import { TaskListSection } from "../TaskListSection";
import { Card } from "../ui/Card";
import { FeatureUsageSection } from "../FeatureUsageSection";
import { FileList, buildFileRows } from "../FileList";
import { BottomPanel } from "../BottomPanel";
import { DecisionsSection } from "../DecisionsSection";
import { ContextChart } from "../ContextChart";
import { computeClientRiskScores } from "../../lib/risk";
import { TabBar } from "../ui/TabBar";
import { TabButton } from "../ui/TabButton";

// -- Types ----------------------------------------------------------------

type OverviewPanelProps = {
	readonly session: DistilledSession;
	readonly sessionId: string;
	readonly isMultiAgent: boolean;
	readonly onRedistill?: () => Promise<void>;
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
	const riskMap = createMemo(() => computeClientRiskScores(props.session));
	const fileRows = createMemo(() => buildFileRows(props.session, riskMap()));
	const totalAdditions = createMemo(() =>
		fileRows().reduce((sum, f) => sum + f.additions, 0),
	);
	const totalDeletions = createMemo(() =>
		fileRows().reduce((sum, f) => sum + f.deletions, 0),
	);

	return (
		<Card>
			<div class="flex items-center gap-3 border-b border-clens px-3 py-2">
				<Files class="h-3.5 w-3.5 text-muted" />
				<h3 class="instrument-microcaps text-[11px] text-muted">
					Modified Files
				</h3>
				<Show when={totalAdditions() > 0}>
					<span class="font-mono text-xs tabular-nums text-[var(--clens-success)]">+{totalAdditions()}</span>
				</Show>
				<Show when={totalDeletions() > 0}>
					<span class="font-mono text-xs tabular-nums text-[var(--clens-danger)]">-{totalDeletions()}</span>
				</Show>
			</div>
			<FileList rows={fileRows()} />
		</Card>
	);
};

// -- Overview content (cards) ---------------------------------------------

const OverviewContent: Component<OverviewPanelProps> = (props) => (
	<div class="space-y-3">
		{/* 1. Session Overview */}
		<SessionOverview session={props.session} onRedistill={props.onRedistill} />

		{/* 1b. Config / Environment (renders nothing for legacy distills w/o config) */}
		<ConfigEnvironment session={props.session} />

		{/* 2. Task Plan */}
		<Show when={props.session.task_list && props.session.task_list.tasks.length > 0 && props.session.task_list}>
			{(taskList) => <TaskListSection taskList={taskList()} />}
		</Show>

		{/* 3. Harness Features (loop / goal / workflow) */}
		<Show when={props.session.feature_usage}>
			{(usage) => <FeatureUsageSection usage={usage()} />}
		</Show>

		{/* 4. Narrative */}
		<Show when={props.session.summary?.narrative}>
			<NarrativeSection session={props.session} />
		</Show>

		{/* 4. Issues & Errors */}
		<IssuesPanel session={props.session} />

		{/* 5. Context Consumption */}
		<Show when={props.session.context_consumption}>
			{(consumption) => <ContextChart consumption={consumption()} />}
		</Show>

		{/* 6. Decision Points */}
		<Show when={props.session.decisions.length > 0}>
			<DecisionsSection decisions={props.session.decisions} />
		</Show>

		{/* 6. Thinking Breakdown */}
		<Show when={props.session.reasoning.length > 0}>
			<ThinkingBreakdown session={props.session} />
		</Show>

		{/* 7. Modified Files */}
		<FileListCard session={props.session} />

		{/* 8. Plan Drift */}
		<Show when={props.session.plan_drift}>
			<PlanDriftSection session={props.session} />
		</Show>
	</div>
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
			<TabBar>
				<For each={visibleTabs()}>
					{(tab) => (
						<TabButton
							label={tab.label}
							active={activeTab() === tab.id}
							onClick={() => setActiveTab(tab.id)}
							badge={tab.count()}
							badgeVariant={tab.id === "backtracks" ? "warning" : "default"}
						/>
					)}
				</For>
			</TabBar>

			{/* Tab content */}
			<div role="tabpanel" class="flex-1 overflow-y-auto">
				<Show when={activeTab() === "overview"}>
					<div class="p-3">
						<OverviewContent
							session={props.session}
							sessionId={props.sessionId}
							isMultiAgent={props.isMultiAgent}
							onRedistill={props.onRedistill}
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
