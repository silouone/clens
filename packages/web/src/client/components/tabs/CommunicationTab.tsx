import { type Component } from "solid-js";
import { CommunicationTimeline } from "../CommunicationTimeline";
import type { TabProps } from "./types";

// ── CommunicationTab — Wave 0 carry-over (Wave 2 reworks) ────────────
// Preserves the original swimlane timeline. Wave 2 adds the AgentGraph
// (nodes=agents, edges=messages) above it (R-C4, AC9).

export const CommunicationTab: Component<TabProps> = (props) => (
	<CommunicationTimeline
		sequence={props.session.comm_sequence ?? []}
		lifetimes={props.session.agent_lifetimes ?? []}
		sessionStartTime={props.session.start_time ?? 0}
	/>
);
