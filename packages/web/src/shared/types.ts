/**
 * Single import source for all @clens/cli types used in the SPA.
 *
 * Usage: import type { SessionSummary, DistilledSession } from "../shared/types";
 */
export type {
	// Session
	SessionSummary,

	// Distill results
	DistilledSession,
	BacktrackResult,
	FileMapEntry,
	FileMapResult,
	GitDiffResult,
	WorkingTreeChange,
	AgentNode,
	CommunicationEdge,
	EditChain,
	EditChainsResult,
	EditStep,
	DiffLine,
	FileDiffAttribution,
	PhaseInfo,
	CostEstimate,
	TimelineEntry,
	PlanDriftReport,

	// Communication
	CommunicationSequenceEntry,
	AgentLifetime,

	// Events
	StoredEvent,

	// Conversation
	AgentMessageEntry,
	ConversationEntry,

	// Risk
	FileRiskScore,
	RiskLevel,
} from "@clens/cli";
