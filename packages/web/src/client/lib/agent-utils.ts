import type { AgentNode } from "../../shared/types";

/** Recursively flatten all agents from the agent tree. */
export const flattenAgents = (agents: readonly AgentNode[]): readonly AgentNode[] =>
	agents.flatMap((a) => [a, ...flattenAgents(a.children)]);
