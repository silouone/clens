import { type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { BacktracksTab, CommunicationTab, EditsTab, TimelineTab } from "./tabs";

// ── BottomPanel — thin sibling-tab dispatcher (overview-moat-refactor) ─
//
// The four sibling tabs now live in their own files under tabs/ (file-disjoint
// for parallel Wave 2 builders). This component is a pure dispatcher: it picks
// the active tab and forwards a uniform TabProps shape. No tab logic lives here.

type TabId = "backtracks" | "timeline" | "edits" | "comms";

type BottomPanelProps = {
	readonly session: DistilledSession;
	readonly isMultiAgent: boolean;
	readonly activeTab?: TabId;
	readonly onBacktrackClick?: (startT: number) => void;
};

export const BottomPanel: Component<BottomPanelProps> = (props) => {
	const currentTab = () => props.activeTab ?? "backtracks";

	const renderTabContent = () => {
		switch (currentTab()) {
			case "backtracks":
				return (
					<BacktracksTab
						session={props.session}
						isMultiAgent={props.isMultiAgent}
						onBacktrackClick={props.onBacktrackClick}
					/>
				);
			case "timeline":
				return <TimelineTab session={props.session} isMultiAgent={props.isMultiAgent} />;
			case "edits":
				return <EditsTab session={props.session} isMultiAgent={props.isMultiAgent} />;
			case "comms":
				return <CommunicationTab session={props.session} isMultiAgent={props.isMultiAgent} />;
		}
	};

	// Single scroll region: this wrapper keeps `h-full` (so TimelineTab's
	// `h-full` flex layout — fixed header + internal `flex-1 overflow-y-auto`
	// list — still resolves against a definite-height parent) but no longer
	// owns an `overflow-y-auto` of its own. The parent tabpanel
	// (OverviewPanel: `flex-1 overflow-y-auto`) is the sole scroller for the
	// non-self-managing sibling tabs (Backtracks/Edits/Comms), removing the
	// redundant nested scroller (#31). TimelineTab keeps its own internal
	// scroll, so its filter/legend header stays pinned.
	return <div class="h-full">{renderTabContent()}</div>;
};
