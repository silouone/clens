import type { AgentNode } from "../../shared/types";

/** Recursively flatten all agents from the agent tree. */
export const flattenAgents = (agents: readonly AgentNode[]): readonly AgentNode[] =>
	agents.flatMap((a) => [a, ...flattenAgents(a.children)]);

/** Recursively search for an agent by session_id in the agent tree. */
export const findAgentInTree = (
	agents: readonly AgentNode[],
	agentId: string,
): AgentNode | undefined =>
	agents.reduce<AgentNode | undefined>(
		(found, agent) =>
			found ??
			(agent.session_id === agentId
				? agent
				: findAgentInTree(agent.children, agentId)),
		undefined,
	);

/** Count all agents including children recursively. */
export const countAllAgents = (agents: readonly AgentNode[]): number =>
	agents.reduce((sum, a) => sum + 1 + countAllAgents(a.children), 0);

/** Sum diff stats (additions/deletions) across an agent's edit chains. */
export const sumDiffStats = (
	agent: AgentNode,
): { readonly additions: number; readonly deletions: number } | undefined => {
	const attrs = agent.edit_chains?.diff_attribution;
	if (!attrs || attrs.length === 0) return undefined;
	return attrs.reduce(
		(acc, f) => ({
			additions: acc.additions + f.total_additions,
			deletions: acc.deletions + f.total_deletions,
		}),
		{ additions: 0, deletions: 0 } as { readonly additions: number; readonly deletions: number },
	);
};
