// TODO: existsSync + readFileSync remain for plan-drift spec reading (lines ~84-90).
// This is the last I/O leak in the distill layer. Ideally the spec content should
// be passed in from the CLI caller so this module stays pure.
import { existsSync, readFileSync } from "node:fs";
import { readLinks, readSessionEvents } from "../session/read";
import { readSessionName, readTranscript, resolveTranscriptPath } from "../session/transcript";
import type {
	AgentNode,
	DistilledSession,
	EditChainsResult,
	LinkEvent,
	SpawnLink,
	StoredEvent,
	TokenUsage,
	TranscriptReasoning,
	TranscriptUserMessage,
} from "../types";
import { buildNameMap, buildTeamMemberSessionMap, filterLinksForSession, isUuidLike } from "../utils";
import { computeActiveDuration } from "./active-duration";
import { type DiffContext, extractAgentModel, extractTokenUsage } from "./agent-distill";
import { enrichNodeWithLinks } from "./agent-enrich";
import { buildAgentTree, enrichNodeFromSessionEvents, enrichNodeWithTranscript, inferAgentsFromComms } from "./agent-tree";
import { aggregateTeamData } from "./aggregate";
import { extractBacktracks } from "./backtracks";
import { buildCommGraph } from "./comm-graph";
import { extractAgentLifetimes, extractCommSequence } from "./comm-sequence";
import { extractDecisions, extractPhases, extractRawTimingGaps } from "./decisions";
import { captureMissingDiffs, extractDiffAttribution } from "./diff-attribution";
import { extractEditChains } from "./edit-chains";
import { extractFileMap } from "./file-map";
import { extractGitDiff, extractNetChanges } from "./git-diff";
import { computePlanDrift, detectSpecRef } from "./plan-drift";
import { extractReasoning } from "./reasoning";
import { estimateCostFromTokens, extractStats } from "./stats";
import { extractSummary } from "./summary";
import { extractTeamMetrics } from "./team";
import { extractTimeline } from "./timeline";
import { extractUserMessages } from "./user-messages";

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

/** Collect all names and session_ids from an agent tree (recursive). */
const collectTreeIdentifiers = (nodes: readonly AgentNode[]): readonly string[] =>
	nodes.flatMap((n) => [
		...(n.agent_name ? [n.agent_name] : []),
		...(n.session_id ? [n.session_id] : []),
		...collectTreeIdentifiers(n.children),
	]);

interface MergeAgentsParams {
	readonly sessionId: string;
	readonly rawAgents: readonly AgentNode[] | undefined;
	readonly sessionLinks: readonly LinkEvent[];
	readonly nameMap: ReadonlyMap<string, string> | undefined;
	readonly readAgentEvents: (agentId: string) => readonly StoredEvent[];
	readonly readTranscriptFn: (path: string) => readonly import("../types").TranscriptEntry[];
	readonly diffContext: DiffContext;
}

/**
 * Merge spawn-based agent tree with comm-inferred agents.
 * Enriches inferred agents from session events + transcripts, then attaches
 * them as children of the spawned agent with the most communication partners.
 */
const mergeSpawnAndInferredAgents = ({
	sessionId,
	rawAgents,
	sessionLinks,
	nameMap,
	readAgentEvents,
	readTranscriptFn,
	diffContext,
}: MergeAgentsParams): readonly AgentNode[] | undefined => {
	const fromTree = rawAgents?.map((node) => enrichNodeWithLinks(node, sessionLinks, nameMap));

	const teamMemberSessions = sessionLinks.length > 0 ? buildTeamMemberSessionMap(sessionLinks) : undefined;
	const inferred = sessionLinks.length > 0
		? inferAgentsFromComms(sessionId, sessionLinks, teamMemberSessions)
		: [];

	const enrichInferredAgent = (node: AgentNode): AgentNode => {
		if (!isUuidLike(node.session_id)) return node;

		const agentEvents = readAgentEvents(node.session_id);
		const fromEvents = agentEvents.length > 0
			? enrichNodeFromSessionEvents(node, agentEvents)
			: node;

		const transcriptPath = resolveTranscriptPath(agentEvents);
		if (transcriptPath) {
			return enrichNodeWithTranscript(fromEvents, transcriptPath, readTranscriptFn, diffContext);
		}
		return fromEvents;
	};

	const enrichAndLink = (agents: readonly AgentNode[]): readonly AgentNode[] => {
		const enriched = agents.map(enrichInferredAgent);
		const inferredNameMap = new Map(enriched.map((a) => [a.session_id, a.agent_name ?? a.agent_type]));
		const mergedNameMap = nameMap ? new Map([...nameMap, ...inferredNameMap]) : inferredNameMap;
		return enriched.map((node) => enrichNodeWithLinks(node, sessionLinks, mergedNameMap));
	};

	if (fromTree && fromTree.length > 0) {
		if (inferred.length === 0) return fromTree;

		const existingNames = new Set(collectTreeIdentifiers(fromTree));
		const newAgents = inferred.filter(
			(a) => !existingNames.has(a.agent_name ?? "") && !existingNames.has(a.session_id),
		);
		if (newAgents.length === 0) return fromTree;

		const enrichedNew = enrichAndLink(newAgents);

		const withMostComms = fromTree.reduce((best, node) =>
			(node.communication_partners?.length ?? 0) > (best.communication_partners?.length ?? 0) ? node : best,
		);
		return fromTree.map((node) =>
			node.session_id === withMostComms.session_id
				? { ...node, children: [...node.children, ...enrichedNew] }
				: node,
		);
	}

	if (inferred.length === 0) return undefined;
	return enrichAndLink(inferred);
};

export interface DistillOptions {
	readonly deep?: boolean;
}

export const distill = async (
	sessionId: string,
	projectDir: string,
	options?: DistillOptions,
): Promise<DistilledSession> => {
	const events = readSessionEvents(sessionId, projectDir);

	// Layer 2: Transcript enrichment (graceful fallback) -- extracted early so reasoning can be passed to stats
	const transcriptData: {
		reasoning: TranscriptReasoning[];
		user_messages: readonly TranscriptUserMessage[];
		transcript_path: string | undefined;
		token_usage: TokenUsage | undefined;
		transcript_model: string | undefined;
		session_name: string | undefined;
	} = (() => {
		const tPath = resolveTranscriptPath(events);
		if (!tPath)
			return {
				reasoning: [],
				user_messages: [],
				transcript_path: undefined,
				token_usage: undefined,
				transcript_model: undefined,
				session_name: undefined,
			};

		const sessionName = readSessionName(tPath) ?? undefined;
		const entries = readTranscript(tPath);
		if (entries.length === 0)
			return {
				reasoning: [],
				user_messages: [],
				transcript_path: tPath,
				token_usage: undefined,
				transcript_model: undefined,
				session_name: sessionName,
			};

		const usage = extractTokenUsage(entries);
		return {
			reasoning: extractReasoning(entries),
			user_messages: extractUserMessages(entries),
			transcript_path: tPath,
			token_usage: usage.input_tokens > 0 ? usage : undefined,
			transcript_model: extractAgentModel(entries),
			session_name: sessionName,
		};
	})();

	const { reasoning, user_messages, transcript_path, token_usage, transcript_model } =
		transcriptData;

	// Layer 0: Link reading (needed early for decisions enrichment)
	const links = readLinks(projectDir);
	const sessionLinks = filterLinksForSession(sessionId, links);
	const nameMap = sessionLinks.length > 0 ? buildNameMap(sessionLinks) : undefined;

	// Layer 1: Hook-based extractors (stats now receives reasoning for cost estimation)
	const stats = extractStats(events, reasoning);
	const backtracks = extractBacktracks(events);
	const decisions = extractDecisions(events, sessionLinks.length > 0 ? sessionLinks : undefined);
	const file_map = extractFileMap(events);
	const git_diff = await extractGitDiff(sessionId, projectDir, events);

	// Plan drift detection
	const allPrompts: readonly string[] = [
		...user_messages
			.filter((m) => m.message_type === "prompt" || m.message_type === "command")
			.map((m) => m.content),
		...events
			.filter((e) => e.event === "UserPromptSubmit" && typeof e.data.prompt === "string")
			.map((e) => e.data.prompt as string),
	];

	const specRef = detectSpecRef(allPrompts);
	const plan_drift = (() => {
		if (!specRef) return undefined;
		if (stats.tool_call_count === 0) return undefined;
		const specPath = `${projectDir}/${specRef}`;
		if (!existsSync(specPath)) return undefined;
		const specContent = readFileSync(specPath, "utf-8");
		return computePlanDrift(specRef, specContent, [file_map], projectDir);
	})();

	// Edit chains: thinking-to-code binding
	const edit_chains_raw = extractEditChains(events, reasoning, backtracks);
	const net_changes = extractNetChanges(projectDir, events);
	const diff_attribution_from_chains = extractDiffAttribution(projectDir, events, edit_chains_raw);

	// Also capture diffs for working tree / staged changes not covered by edit chains
	const allChangedFiles = [...(git_diff.working_tree_changes ?? []), ...(git_diff.staged_changes ?? []), ...net_changes];
	const extraDiffs = captureMissingDiffs(projectDir, events, diff_attribution_from_chains, allChangedFiles);
	const diff_attribution = [...diff_attribution_from_chains, ...extraDiffs];

	const edit_chains: EditChainsResult = {
		...edit_chains_raw,
		...(net_changes.length > 0 ? { net_changes } : {}),
		...(diff_attribution.length > 0 ? { diff_attribution } : {}),
	};

	// Layer 4: Sub-agent hierarchy (graceful -- no error if links file missing)
	const readAgentEvents = (agentId: string): readonly StoredEvent[] => {
		try {
			return readSessionEvents(agentId, projectDir);
		} catch {
			return [];
		}
	};
	const diffContext: DiffContext = { projectDir, parentEvents: events };
	const rawAgents =
		sessionLinks.length > 0
			? buildAgentTree(sessionId, sessionLinks, events, readTranscript, readAgentEvents, diffContext)
			: undefined;

	// Merge spawn-based tree with comm-inferred agents (team teammates not captured by spawn links)
	const agents = mergeSpawnAndInferredAgents({
		sessionId,
		rawAgents,
		sessionLinks,
		nameMap,
		readAgentEvents,
		readTranscriptFn: readTranscript,
		diffContext,
	});

	// Build effective nameMap that includes inferred agent names for downstream extractors
	const effectiveNameMap = (() => {
		if (agents && !nameMap) {
			return new Map(agents.map((a) => [a.session_id, a.agent_name ?? a.agent_type]));
		}
		if (agents && nameMap) {
			const inferredEntries = agents
				.filter((a) => !nameMap.has(a.session_id))
				.map((a) => [a.session_id, a.agent_name ?? a.agent_type] as const);
			return inferredEntries.length > 0 ? new Map([...nameMap, ...inferredEntries]) : nameMap;
		}
		return nameMap;
	})();

	// Ensure parent/orchestrator session is in the nameMap so comm graph/sequence show "leader" not raw UUIDs
	const finalNameMap = (() => {
		const base = effectiveNameMap ?? new Map<string, string>();
		if (base.has(sessionId)) return base;
		if (sessionLinks.length === 0) return base;
		return new Map([...base, [sessionId, "leader"]]);
	})();

	const allAgentIds =
		sessionLinks.length > 0
			? new Set(sessionLinks.filter(isSpawnLink).map((s) => s.agent_id))
			: undefined;
	const team_metrics =
		sessionLinks.length > 0 ? extractTeamMetrics(sessionLinks, allAgentIds, sessionId) : undefined;
	const communication_graph =
		sessionLinks.length > 0 ? buildCommGraph(sessionLinks, finalNameMap) : undefined;
	const comm_sequence =
		sessionLinks.length > 0 ? extractCommSequence(sessionLinks, finalNameMap) : undefined;
	const agent_lifetimes =
		sessionLinks.length > 0 ? extractAgentLifetimes(sessionLinks, finalNameMap) : undefined;

	// Model inference: stats.model → transcript model → first agent model
	const inferredModel = stats.model ?? transcript_model ?? agents?.find((a) => a.model)?.model;

	// Cost estimation: prefer real token counts from transcript over heuristic
	const resolvedModel = inferredModel ?? stats.model;
	const parentCostEstimate = (() => {
		if (!resolvedModel) return stats.cost_estimate;
		// When real token counts are available from transcript, use them
		if (token_usage) {
			return (
				estimateCostFromTokens(
					resolvedModel,
					token_usage.input_tokens,
					token_usage.output_tokens,
					token_usage.cache_read_tokens,
					token_usage.cache_creation_tokens,
				) ?? stats.cost_estimate
			);
		}
		// Otherwise fall back to heuristic (already computed in stats)
		return stats.cost_estimate;
	})();

	const finalStats =
		inferredModel && !stats.model
			? {
					...stats,
					model: inferredModel,
					cost_estimate: parentCostEstimate,
				}
			: parentCostEstimate !== stats.cost_estimate
				? { ...stats, cost_estimate: parentCostEstimate }
				: stats;

	// Aggregate agent data into parent-level stats when agents are present
	const aggregated =
		agents && agents.length > 0
			? aggregateTeamData({
					parentStats: finalStats,
					parentFileMap: file_map,
					parentEditChains: edit_chains,
					parentBacktracks: backtracks,
					parentReasoning: reasoning,
					parentCost: finalStats.cost_estimate,
					agents,
				})
			: undefined;

	const effectiveStats = aggregated
		? {
				...aggregated.stats,
				cost_estimate: aggregated.cost_estimate ?? aggregated.stats.cost_estimate,
			}
		: finalStats;
	const effectiveFileMap = aggregated?.file_map ?? file_map;
	const effectiveEditChains = aggregated?.edit_chains ?? edit_chains;
	const effectiveBacktracks = aggregated?.backtracks ?? backtracks;
	const effectiveReasoning = aggregated?.reasoning ?? reasoning;

	// Active duration computation (uses raw unfiltered timing gaps, not noise-filtered decisions)
	const rawTimingGaps = extractRawTimingGaps(events);
	const rawActiveDuration = computeActiveDuration(rawTimingGaps, effectiveStats.duration_ms);

	// For multi-agent sessions, parent timing gaps alone may show 0 active time.
	// Fallback: use wall duration when agents exist but raw computation yields 0.
	const activeDuration =
		rawActiveDuration.active_ms === 0 && agents && agents.length > 0
			? { ...rawActiveDuration, active_ms: effectiveStats.duration_ms }
			: rawActiveDuration;

	// Layer 3: Synthesis
	const phases = extractPhases(events, sessionLinks.length > 0 ? sessionLinks : undefined);
	const summary = extractSummary({
		stats: effectiveStats,
		backtracks: effectiveBacktracks,
		phases,
		file_map: effectiveFileMap.files,
		reasoning: effectiveReasoning,
		team_metrics,
		activeDuration,
		agents,
		events,
		editChains: effectiveEditChains,
	});
	const timeline = extractTimeline(
		events,
		effectiveReasoning,
		user_messages,
		effectiveBacktracks,
		phases,
		sessionLinks.length > 0 ? sessionLinks : undefined,
		finalNameMap,
	);

	const result: DistilledSession = {
		session_id: sessionId,
		...(transcriptData.session_name ? { session_name: transcriptData.session_name } : {}),
		start_time: events[0]?.t,
		stats: effectiveStats,
		backtracks: [...effectiveBacktracks],
		decisions,
		file_map: effectiveFileMap,
		git_diff,
		edit_chains: effectiveEditChains,
		reasoning: [...effectiveReasoning],
		user_messages,
		transcript_path,
		summary,
		timeline,
		...(agents && agents.length > 0 ? { agents } : {}),
		...(team_metrics && team_metrics.agent_count > 0 ? { team_metrics } : {}),
		...(communication_graph && communication_graph.length > 0 ? { communication_graph } : {}),
		...(comm_sequence && comm_sequence.length > 0 ? { comm_sequence } : {}),
		...(agent_lifetimes && agent_lifetimes.length > 0 ? { agent_lifetimes } : {}),
		...(plan_drift ? { plan_drift } : {}),
		complete: true,
	};

	return result;
};
