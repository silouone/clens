import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import type { DistilledSession } from "../../../shared/types";
import type { DetailTabId } from "../../lib/categories";
import { BottomPanel } from "../BottomPanel";
import { DashboardGrid } from "../ui/DashboardGrid";
import { TabBar } from "../ui/TabBar";
import { TabButton } from "../ui/TabButton";
import { HeroBand } from "../overview/HeroBand";
import {
	ActivityWidget,
	AgentsWidget,
	ConfigWidget,
	ContextWidget,
	CostWidget,
	EditsWidget,
	FilesWidget,
	OutcomeWidget,
	ReasoningWidget,
	RiskWidget,
	TaskPlanWidget,
} from "../overview/widgets";

// -- Types ----------------------------------------------------------------

type OverviewPanelProps = {
	readonly session: DistilledSession;
	readonly sessionId: string;
	readonly isMultiAgent: boolean;
	readonly onRedistill?: () => Promise<void>;
};

type TabDef = {
	readonly id: DetailTabId;
	readonly label: string;
	readonly count: () => number;
	readonly visible: boolean;
};

// -- Overview content (HeroBand + bento widget grid) ----------------------
//
// Wave 0 scaffold: the dominant HeroBand on top, then a DashboardGrid of
// category-channelled widgets wired to real session data. Each widget is a
// Wave-0 stub (minimal body); Wave 1 builders flesh out one file each. Sparse
// data is Show-guarded so the sparse fixture renders no empty colored shells
// (R-E1). `onNavigate` gives every glanceable signal a single-click jump to its
// sibling tab (R-A5).

const OverviewContent: Component<{
	readonly session: DistilledSession;
	readonly isMultiAgent: boolean;
	readonly onNavigate: (tab: DetailTabId) => void;
}> = (props) => {
	// Props are passed explicitly (not spread from a snapshot object) so each
	// widget tracks `props.session` reactively — an in-place update such as a
	// re-analyze refreshes the whole grid, not just the HeroBand.
	const session = () => props.session;
	const isMultiAgent = () => props.isMultiAgent;
	const onNavigate = (tab: DetailTabId) => props.onNavigate(tab);

	return (
		<div class="space-y-3">
			<HeroBand session={session()} />

			<DashboardGrid>
				<Show when={session().context_consumption}>
					<ContextWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>

				<RiskWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />

				<Show when={(session().edit_chains?.chains.length ?? 0) > 0}>
					<EditsWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>

				<Show when={(session().timeline?.length ?? 0) > 0}>
					<ActivityWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>

				<Show when={isMultiAgent()}>
					<AgentsWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>

				<CostWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				<OutcomeWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				<FilesWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />

				<Show when={session().session_config}>
					<ConfigWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>

				<Show when={(session().task_list?.tasks.length ?? 0) > 0}>
					<TaskPlanWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>

				<Show when={session().reasoning.length > 0}>
					<ReasoningWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
				</Show>
			</DashboardGrid>
		</div>
	);
};

// -- Main component -------------------------------------------------------

export const OverviewPanel: Component<OverviewPanelProps> = (props) => {
	const [activeTab, setActiveTab] = createSignal<DetailTabId>("overview");

	const tabs = createMemo((): readonly TabDef[] => [
		{ id: "overview", label: "Overview", count: () => 0, visible: true },
		{
			id: "backtracks",
			label: "Backtracks",
			count: () => props.session.backtracks.length,
			visible: true,
		},
		{
			id: "timeline",
			label: "Timeline",
			count: () => props.session.timeline?.length ?? 0,
			visible: (props.session.timeline?.length ?? 0) > 0,
		},
		{
			id: "edits",
			label: "Edits",
			count: () => props.session.edit_chains?.chains.length ?? 0,
			visible: (props.session.edit_chains?.chains.length ?? 0) > 0,
		},
		{
			id: "comms",
			label: "Communication",
			count: () => props.session.comm_sequence?.length ?? 0,
			visible: props.isMultiAgent,
		},
	]);

	const visibleTabs = createMemo(() => tabs().filter((t) => t.visible));

	return (
		<div class="flex h-full flex-col overflow-hidden">
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

			<div role="tabpanel" class="flex-1 overflow-y-auto">
				<Show when={activeTab() === "overview"}>
					<div class="p-3">
						<OverviewContent
							session={props.session}
							isMultiAgent={props.isMultiAgent}
							onNavigate={setActiveTab}
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
