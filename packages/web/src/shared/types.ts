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

	// Links
	LinkEvent,
	SpawnLink,
	StopLink,
	MessageLink,
	LinkEventType,

	// Conversation
	AgentMessageEntry,
	ConversationEntry,

	// Risk
	FileRiskScore,
	RiskLevel,

	// Transcript
	TranscriptReasoning,
	TranscriptUserMessage,

	// Distill extras
	DistilledSummary,
	TeamMetrics,
	DecisionPoint,
	TaskRecord,
	TaskListResult,

	// Work Units
	WorkUnit,
	WorkUnitIndex,
	WorkUnitSession,
	WorkUnitSessionRole,
	WorkUnitLinkType,

	// Config
	ClensConfig,
	PricingTier,
} from "@clens/cli";
