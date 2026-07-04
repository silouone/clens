import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { DistilledSession } from "../../../shared/types";
import { anyOverviewWidgetShown, shown } from "../../lib/archived-widgets";
import type { DetailTabId } from "../../lib/categories";
import { BottomPanel } from "../BottomPanel";
import { HeroBand } from "../overview/HeroBand";
import {
	ActivityWidget,
	AgentsWidget,
	ConfigWidget,
	ContextWidget,
	CostWidget,
	EditsWidget,
	FilesWidget,
	HarnessFeaturesWidget,
	OutcomeWidget,
	ReasoningWidget,
	RiskWidget,
	TaskPlanWidget,
} from "../overview/widgets";
import { DashboardGrid } from "../ui/DashboardGrid";
import { TabBar } from "../ui/TabBar";
import { TabButton } from "../ui/TabButton";

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

// -- Overview content (answer card + archived widget grid) -----------------
//
// Session-detail v6 (slice #3): the Overview IS the answer card (HeroBand) —
// the four tabs own all detail. The former bento grid is dissolved behind the
// reversible ARCHIVED_WIDGETS flag (lib/archived-widgets.ts): every widget
// render site is additionally gated by `shown("w_<id>")`, and the grid
// container itself disappears while every id is archived. Nothing is deleted;
// removing one id from the set restores that card, its original data guard
// (Show on session shape) intact.

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

			<Show when={anyOverviewWidgetShown()}>
				<DashboardGrid>
					<Show when={shown("w_context") && session().context_consumption}>
						<ContextWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_risk")}>
						<RiskWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
					</Show>

					<Show when={shown("w_edits") && (session().edit_chains?.chains.length ?? 0) > 0}>
						<EditsWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_activity") && (session().timeline?.length ?? 0) > 0}>
						<ActivityWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_agents") && isMultiAgent()}>
						<AgentsWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_cost")}>
						<CostWidget session={session()} isMultiAgent={isMultiAgent()} onNavigate={onNavigate} />
					</Show>

					<Show when={shown("w_outcome")}>
						<OutcomeWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_files")}>
						<FilesWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_config") && session().session_config}>
						<ConfigWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_taskplan") && (session().task_list?.tasks.length ?? 0) > 0}>
						<TaskPlanWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_harness") && session().feature_usage}>
						<HarnessFeaturesWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>

					<Show when={shown("w_reasoning") && session().reasoning.length > 0}>
						<ReasoningWidget
							session={session()}
							isMultiAgent={isMultiAgent()}
							onNavigate={onNavigate}
						/>
					</Show>
				</DashboardGrid>
			</Show>
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
