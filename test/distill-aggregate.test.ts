import { describe, expect, test } from "bun:test";
import {
	aggregateTeamData,
	mergeBacktracks,
	mergeCostEstimates,
	mergeEditChains,
	mergeFileMaps,
	mergeStats,
} from "../src/distill/aggregate";
import { flattenAgents } from "../src/utils";
import type {
	AgentNode,
	AgentStats,
	BacktrackResult,
	CostEstimate,
	EditChain,
	EditChainsResult,
	FileMapEntry,
	FileMapResult,
	StatsResult,
	TranscriptReasoning,
} from "../src/types";

// ---------------------------------------------------------------------------
// Helpers: minimal valid objects matching the type interfaces
// ---------------------------------------------------------------------------

const makeAgentNode = (overrides: Partial<AgentNode> & { session_id: string }): AgentNode => ({
	agent_type: "builder",
	duration_ms: 5000,
	tool_call_count: 10,
	children: [],
	...overrides,
});

const makeFileMapEntry = (
	overrides: Partial<FileMapEntry> & { file_path: string },
): FileMapEntry => ({
	reads: 0,
	edits: 0,
	writes: 0,
	errors: 0,
	tool_use_ids: [],
	...overrides,
});

const makeStatsResult = (overrides: Partial<StatsResult> = {}): StatsResult => ({
	total_events: 10,
	duration_ms: 5000,
	events_by_type: {},
	tools_by_name: {},
	tool_call_count: 0,
	failure_count: 0,
	failure_rate: 0,
	unique_files: [],
	...overrides,
});

const makeAgentStats = (overrides: Partial<AgentStats> = {}): AgentStats => ({
	tool_call_count: 0,
	failure_count: 0,
	tools_by_name: {},
	unique_files: [],
	...overrides,
});

const makeBacktrack = (
	overrides: Partial<BacktrackResult> = {},
): BacktrackResult => ({
	type: "failure_retry",
	tool_name: "Edit",
	attempts: 2,
	start_t: 1000,
	end_t: 2000,
	tool_use_ids: ["t1"],
	...overrides,
});

const makeEditChain = (
	overrides: Partial<EditChain> = {},
): EditChain => ({
	file_path: "/src/app.ts",
	steps: [],
	total_edits: 1,
	total_failures: 0,
	total_reads: 1,
	effort_ms: 500,
	has_backtrack: false,
	surviving_edit_ids: ["e1"],
	abandoned_edit_ids: [],
	...overrides,
});

const makeCostEstimate = (
	overrides: Partial<CostEstimate> = {},
): CostEstimate => ({
	model: "claude-sonnet-4-20250514",
	estimated_input_tokens: 1000,
	estimated_output_tokens: 500,
	estimated_cost_usd: 0.05,
	...overrides,
});

// ---------------------------------------------------------------------------
// flattenAgents
// ---------------------------------------------------------------------------

describe("flattenAgents", () => {
	test("empty array returns empty", () => {
		const result = flattenAgents([]);
		expect(result).toEqual([]);
	});

	test("single agent with no children returns [agent]", () => {
		const agent = makeAgentNode({ session_id: "a1" });
		const result = flattenAgents([agent]);
		expect(result).toHaveLength(1);
		expect(result[0].session_id).toBe("a1");
	});

	test("3-level nesting: agent with child that has grandchild - all 3 returned flat", () => {
		const grandchild = makeAgentNode({ session_id: "gc1", agent_type: "tester" });
		const child = makeAgentNode({
			session_id: "c1",
			agent_type: "builder",
			children: [grandchild],
		});
		const root = makeAgentNode({
			session_id: "r1",
			agent_type: "lead",
			children: [child],
		});

		const result = flattenAgents([root]);
		expect(result).toHaveLength(3);
		expect(result.map((a) => a.session_id)).toEqual(["r1", "c1", "gc1"]);
	});

	test("multiple roots with children are all flattened", () => {
		const child1 = makeAgentNode({ session_id: "c1" });
		const child2 = makeAgentNode({ session_id: "c2" });
		const root1 = makeAgentNode({ session_id: "r1", children: [child1] });
		const root2 = makeAgentNode({ session_id: "r2", children: [child2] });

		const result = flattenAgents([root1, root2]);
		expect(result).toHaveLength(4);
		expect(result.map((a) => a.session_id)).toEqual(["r1", "c1", "r2", "c2"]);
	});
});

// ---------------------------------------------------------------------------
// mergeFileMaps
// ---------------------------------------------------------------------------

describe("mergeFileMaps", () => {
	test("empty inputs returns empty files", () => {
		const result = mergeFileMaps([]);
		expect(result.files).toEqual([]);
	});

	test("single map returned as-is", () => {
		const entry = makeFileMapEntry({
			file_path: "/src/app.ts",
			reads: 3,
			edits: 1,
			tool_use_ids: ["t1", "t2"],
		});
		const result = mergeFileMaps([{ files: [entry] }]);
		expect(result.files).toHaveLength(1);
		expect(result.files[0].file_path).toBe("/src/app.ts");
		expect(result.files[0].reads).toBe(3);
		expect(result.files[0].edits).toBe(1);
		expect(result.files[0].tool_use_ids).toEqual(["t1", "t2"]);
	});

	test("two maps with overlapping file_paths: reads/edits/writes/errors summed correctly", () => {
		const map1: FileMapResult = {
			files: [
				makeFileMapEntry({
					file_path: "/src/app.ts",
					reads: 2,
					edits: 1,
					writes: 0,
					errors: 1,
					tool_use_ids: ["t1", "t2"],
				}),
			],
		};
		const map2: FileMapResult = {
			files: [
				makeFileMapEntry({
					file_path: "/src/app.ts",
					reads: 1,
					edits: 3,
					writes: 1,
					errors: 0,
					tool_use_ids: ["t3"],
				}),
			],
		};

		const result = mergeFileMaps([map1, map2]);
		expect(result.files).toHaveLength(1);

		const merged = result.files[0];
		expect(merged.file_path).toBe("/src/app.ts");
		expect(merged.reads).toBe(3);
		expect(merged.edits).toBe(4);
		expect(merged.writes).toBe(1);
		expect(merged.errors).toBe(1);
		expect(merged.tool_use_ids).toEqual(["t1", "t2", "t3"]);
	});

	test("disjoint files: all preserved", () => {
		const map1: FileMapResult = {
			files: [makeFileMapEntry({ file_path: "/src/a.ts", reads: 1 })],
		};
		const map2: FileMapResult = {
			files: [makeFileMapEntry({ file_path: "/src/b.ts", edits: 2 })],
		};

		const result = mergeFileMaps([map1, map2]);
		expect(result.files).toHaveLength(2);

		const paths = result.files.map((f) => f.file_path).sort();
		expect(paths).toEqual(["/src/a.ts", "/src/b.ts"]);
	});

	test("source field preserved from first entry when merging", () => {
		const map1: FileMapResult = {
			files: [makeFileMapEntry({ file_path: "/src/a.ts", source: "tool" })],
		};
		const map2: FileMapResult = {
			files: [makeFileMapEntry({ file_path: "/src/a.ts", source: "bash" })],
		};

		const result = mergeFileMaps([map1, map2]);
		expect(result.files).toHaveLength(1);
		expect(result.files[0].source).toBe("tool");
	});
});

// ---------------------------------------------------------------------------
// mergeStats
// ---------------------------------------------------------------------------

describe("mergeStats", () => {
	test("parent + 2 agent stats: tool_call_count sums, unique_files is union, tools_by_name merged", () => {
		const parentStats = makeStatsResult({
			tool_call_count: 5,
			failure_count: 1,
			failure_rate: 0.2,
			unique_files: ["/src/a.ts", "/src/b.ts"],
			tools_by_name: { Read: 3, Edit: 2 },
			duration_ms: 10000,
		});

		const agent1: AgentStats = makeAgentStats({
			tool_call_count: 8,
			failure_count: 2,
			unique_files: ["/src/b.ts", "/src/c.ts"],
			tools_by_name: { Read: 1, Bash: 4, Edit: 3 },
		});

		const agent2: AgentStats = makeAgentStats({
			tool_call_count: 3,
			failure_count: 0,
			unique_files: ["/src/d.ts"],
			tools_by_name: { Write: 2, Read: 1 },
		});

		const result = mergeStats(parentStats, [agent1, agent2]);

		// tool_call_count: 5 + 8 + 3 = 16
		expect(result.tool_call_count).toBe(16);

		// failure_count: 1 + 2 + 0 = 3
		expect(result.failure_count).toBe(3);

		// failure_rate: 3 / 16 = 0.1875
		expect(result.failure_rate).toBe(3 / 16);

		// unique_files: union of all = [a, b, c, d]
		const uniqueSorted = [...result.unique_files].sort();
		expect(uniqueSorted).toEqual(["/src/a.ts", "/src/b.ts", "/src/c.ts", "/src/d.ts"]);

		// tools_by_name: Read: 3+1+1=5, Edit: 2+3=5, Bash: 4, Write: 2
		expect(result.tools_by_name.Read).toBe(5);
		expect(result.tools_by_name.Edit).toBe(5);
		expect(result.tools_by_name.Bash).toBe(4);
		expect(result.tools_by_name.Write).toBe(2);

		// parent duration preserved
		expect(result.duration_ms).toBe(10000);
	});

	test("no agents: returns parent stats as-is with recomputed failure_rate", () => {
		const parentStats = makeStatsResult({
			tool_call_count: 10,
			failure_count: 2,
			failure_rate: 0.2,
		});

		const result = mergeStats(parentStats, []);
		expect(result.tool_call_count).toBe(10);
		expect(result.failure_count).toBe(2);
		expect(result.failure_rate).toBe(0.2);
	});

	test("failure_rate is 0 when total tool_call_count is 0", () => {
		const parentStats = makeStatsResult({
			tool_call_count: 0,
			failure_count: 0,
		});

		const result = mergeStats(parentStats, []);
		expect(result.failure_rate).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// mergeEditChains
// ---------------------------------------------------------------------------

describe("mergeEditChains", () => {
	test("parent chain + agent chain for same file: kept separate with agent_name tags", () => {
		const parentChains: EditChainsResult = {
			chains: [makeEditChain({ file_path: "/src/app.ts" })],
			net_changes: [{ file_path: "/src/app.ts", status: "modified", additions: 5, deletions: 2 }],
		};

		const agentChains = [
			{
				agentName: "builder-a",
				chains: {
					chains: [makeEditChain({ file_path: "/src/app.ts" })],
				} as EditChainsResult,
			},
		];

		const result = mergeEditChains(parentChains, agentChains);

		// Both chains preserved (parent chain + agent chain)
		expect(result.chains).toHaveLength(2);

		// Parent chain does not get agent_name tag
		expect(result.chains[0].agent_name).toBeUndefined();

		// Agent chain gets agent_name tag
		expect(result.chains[1].agent_name).toBe("builder-a");

		// Both point at same file
		expect(result.chains[0].file_path).toBe("/src/app.ts");
		expect(result.chains[1].file_path).toBe("/src/app.ts");
	});

	test("agent chain for different file: added to result", () => {
		const parentChains: EditChainsResult = {
			chains: [makeEditChain({ file_path: "/src/app.ts" })],
		};

		const agentChains = [
			{
				agentName: "builder-b",
				chains: {
					chains: [makeEditChain({ file_path: "/src/utils.ts" })],
				} as EditChainsResult,
			},
		];

		const result = mergeEditChains(parentChains, agentChains);
		expect(result.chains).toHaveLength(2);

		const paths = result.chains.map((c) => c.file_path);
		expect(paths).toContain("/src/app.ts");
		expect(paths).toContain("/src/utils.ts");
	});

	test("net_changes preserved from parent", () => {
		const netChanges = [
			{ file_path: "/src/app.ts", status: "modified" as const, additions: 10, deletions: 3 },
		];
		const parentChains: EditChainsResult = {
			chains: [],
			net_changes: netChanges,
		};

		const result = mergeEditChains(parentChains, []);
		expect(result.net_changes).toEqual(netChanges);
	});

	test("multiple agents contribute chains with their names", () => {
		const parentChains: EditChainsResult = { chains: [] };

		const agentChains = [
			{
				agentName: "agent-1",
				chains: {
					chains: [
						makeEditChain({ file_path: "/src/a.ts" }),
						makeEditChain({ file_path: "/src/b.ts" }),
					],
				} as EditChainsResult,
			},
			{
				agentName: "agent-2",
				chains: {
					chains: [makeEditChain({ file_path: "/src/c.ts" })],
				} as EditChainsResult,
			},
		];

		const result = mergeEditChains(parentChains, agentChains);
		expect(result.chains).toHaveLength(3);
		expect(result.chains[0].agent_name).toBe("agent-1");
		expect(result.chains[1].agent_name).toBe("agent-1");
		expect(result.chains[2].agent_name).toBe("agent-2");
	});
});

// ---------------------------------------------------------------------------
// mergeBacktracks
// ---------------------------------------------------------------------------

describe("mergeBacktracks", () => {
	test("empty arrays returns empty", () => {
		const result = mergeBacktracks([], []);
		expect(result).toEqual([]);
	});

	test("parent + agent backtracks sorted by start_t", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({ start_t: 3000, end_t: 4000, tool_use_ids: ["p1"] }),
			makeBacktrack({ start_t: 1000, end_t: 2000, tool_use_ids: ["p2"] }),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({ start_t: 2500, end_t: 3500, tool_name: "Bash", tool_use_ids: ["a1"] }),
			],
			[
				makeBacktrack({ start_t: 500, end_t: 1500, tool_name: "Read", tool_use_ids: ["a2"] }),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		expect(result).toHaveLength(4);

		// Verify sorted by start_t ascending
		const startTimes = result.map((b) => b.start_t);
		expect(startTimes).toEqual([500, 1000, 2500, 3000]);
	});

	test("parent only returns parent backtracks sorted", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({ start_t: 5000, tool_use_ids: ["p1"] }),
			makeBacktrack({ start_t: 2000, tool_use_ids: ["p2"] }),
		];

		const result = mergeBacktracks(parentBacktracks, []);
		expect(result).toHaveLength(2);
		expect(result[0].start_t).toBe(2000);
		expect(result[1].start_t).toBe(5000);
	});

	test("agents only returns agent backtracks sorted", () => {
		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[makeBacktrack({ start_t: 8000, tool_use_ids: ["a1"] }), makeBacktrack({ start_t: 1000, tool_use_ids: ["a2"] })],
		];

		const result = mergeBacktracks([], agentBacktracks);
		expect(result).toHaveLength(2);
		expect(result[0].start_t).toBe(1000);
		expect(result[1].start_t).toBe(8000);
	});

	test("deduplicates entries with same type+file_path and ≥50% tool_use_id overlap", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({
				type: "failure_retry",
				file_path: "/src/app.ts",
				tool_use_ids: ["t1", "t2", "t3"],
				start_t: 1000,
			}),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({
					type: "failure_retry",
					file_path: "/src/app.ts",
					tool_use_ids: ["t2", "t3"], // 2/min(3,2)=2/2=1.0 overlap
					start_t: 1500,
				}),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		// Deduplicated: keep the one with more tool_use_ids (parent's 3 > agent's 2)
		expect(result).toHaveLength(1);
		expect(result[0].tool_use_ids).toEqual(["t1", "t2", "t3"]);
	});

	test("keeps both when tool_use_id overlap < 50%", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({
				type: "failure_retry",
				file_path: "/src/app.ts",
				tool_use_ids: ["t1", "t2", "t3", "t4"],
				start_t: 1000,
			}),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({
					type: "failure_retry",
					file_path: "/src/app.ts",
					tool_use_ids: ["t4", "t5", "t6", "t7"], // 1/min(4,4)=0.25 overlap
					start_t: 2000,
				}),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		expect(result).toHaveLength(2);
	});

	test("keeps both when types differ even with overlapping ids", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({
				type: "failure_retry",
				file_path: "/src/app.ts",
				tool_use_ids: ["t1", "t2"],
				start_t: 1000,
			}),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({
					type: "debugging_loop",
					file_path: "/src/app.ts",
					tool_use_ids: ["t1", "t2"], // same ids but different type
					start_t: 2000,
				}),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		expect(result).toHaveLength(2);
	});

	test("keeps both when file_paths differ even with overlapping ids", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({
				type: "failure_retry",
				file_path: "/src/a.ts",
				tool_use_ids: ["t1", "t2"],
				start_t: 1000,
			}),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({
					type: "failure_retry",
					file_path: "/src/b.ts",
					tool_use_ids: ["t1", "t2"], // same ids but different file
					start_t: 2000,
				}),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		expect(result).toHaveLength(2);
	});

	test("prefers entry with more tool_use_ids during dedup", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({
				type: "failure_retry",
				file_path: "/src/app.ts",
				tool_use_ids: ["t1", "t2"],
				start_t: 1000,
			}),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({
					type: "failure_retry",
					file_path: "/src/app.ts",
					tool_use_ids: ["t1", "t2", "t3", "t4"], // overlap 2/min(2,4)=2/2=1.0, more ids
					start_t: 2000,
				}),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		expect(result).toHaveLength(1);
		// Should keep the agent's entry (more tool_use_ids)
		expect(result[0].tool_use_ids).toEqual(["t1", "t2", "t3", "t4"]);
	});

	test("dedup handles empty tool_use_ids (overlap = 0)", () => {
		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({
				type: "failure_retry",
				file_path: "/src/app.ts",
				tool_use_ids: [],
				start_t: 1000,
			}),
		];

		const agentBacktracks: (readonly BacktrackResult[])[] = [
			[
				makeBacktrack({
					type: "failure_retry",
					file_path: "/src/app.ts",
					tool_use_ids: [],
					start_t: 2000,
				}),
			],
		];

		const result = mergeBacktracks(parentBacktracks, agentBacktracks);
		// Empty arrays have 0 overlap, so both kept
		expect(result).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// mergeCostEstimates
// ---------------------------------------------------------------------------

describe("mergeCostEstimates", () => {
	test("all undefined returns undefined", () => {
		const result = mergeCostEstimates(undefined, [undefined, undefined]);
		expect(result).toBeUndefined();
	});

	test("parent only returns parent", () => {
		const parent = makeCostEstimate({
			estimated_input_tokens: 2000,
			estimated_output_tokens: 1000,
			estimated_cost_usd: 0.1,
		});

		const result = mergeCostEstimates(parent, [undefined]);
		expect(result).toBeDefined();
		expect(result?.model).toBe("claude-sonnet-4-20250514");
		expect(result?.estimated_input_tokens).toBe(2000);
		expect(result?.estimated_output_tokens).toBe(1000);
		expect(result?.estimated_cost_usd).toBe(0.1);
	});

	test("parent + agents: tokens and costs summed", () => {
		const parent = makeCostEstimate({
			model: "claude-opus-4-20250514",
			estimated_input_tokens: 5000,
			estimated_output_tokens: 2000,
			estimated_cost_usd: 0.25,
		});

		const agentCosts: (CostEstimate | undefined)[] = [
			makeCostEstimate({
				model: "claude-sonnet-4-20250514",
				estimated_input_tokens: 3000,
				estimated_output_tokens: 1500,
				estimated_cost_usd: 0.1,
			}),
			makeCostEstimate({
				model: "claude-sonnet-4-20250514",
				estimated_input_tokens: 2000,
				estimated_output_tokens: 800,
				estimated_cost_usd: 0.05,
			}),
			undefined,
		];

		const result = mergeCostEstimates(parent, agentCosts);
		expect(result).toBeDefined();

		// Model comes from parent
		expect(result?.model).toBe("claude-opus-4-20250514");

		// Tokens summed: 5000 + 3000 + 2000 = 10000
		expect(result?.estimated_input_tokens).toBe(10000);
		// 2000 + 1500 + 800 = 4300
		expect(result?.estimated_output_tokens).toBe(4300);
		// 0.25 + 0.1 + 0.05 = 0.4 (rounded to 4 decimals)
		expect(result?.estimated_cost_usd).toBe(0.4);
	});

	test("agents only (no parent): uses first agent model", () => {
		const agentCosts: (CostEstimate | undefined)[] = [
			undefined,
			makeCostEstimate({
				model: "claude-haiku-3-20250514",
				estimated_input_tokens: 1000,
				estimated_output_tokens: 500,
				estimated_cost_usd: 0.01,
			}),
		];

		const result = mergeCostEstimates(undefined, agentCosts);
		expect(result).toBeDefined();
		expect(result?.model).toBe("claude-haiku-3-20250514");
		expect(result?.estimated_input_tokens).toBe(1000);
		expect(result?.estimated_output_tokens).toBe(500);
	});

	test("cost_usd is rounded to 4 decimal places", () => {
		const parent = makeCostEstimate({ estimated_cost_usd: 0.00001 });
		const agent = makeCostEstimate({ estimated_cost_usd: 0.00002 });

		const result = mergeCostEstimates(parent, [agent]);
		expect(result).toBeDefined();
		// 0.00001 + 0.00002 = 0.00003, rounded to 4 decimals = 0
		expect(result?.estimated_cost_usd).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// aggregateTeamData - end-to-end
// ---------------------------------------------------------------------------

describe("aggregateTeamData", () => {
	test("end-to-end with mock AgentNode tree (2 agents with stats/file_map/edit_chains/backtracks)", () => {
		// -- Parent data --
		const parentStats = makeStatsResult({
			total_events: 20,
			duration_ms: 15000,
			tool_call_count: 6,
			failure_count: 1,
			failure_rate: 1 / 6,
			unique_files: ["/src/index.ts"],
			tools_by_name: { Read: 4, Edit: 2 },
			events_by_type: { PreToolUse: 6 },
		});

		const parentFileMap: FileMapResult = {
			files: [
				makeFileMapEntry({
					file_path: "/src/index.ts",
					reads: 4,
					edits: 2,
					tool_use_ids: ["p1", "p2", "p3", "p4", "p5", "p6"],
				}),
			],
		};

		const parentEditChains: EditChainsResult = {
			chains: [
				makeEditChain({
					file_path: "/src/index.ts",
					total_edits: 2,
					total_reads: 4,
				}),
			],
			net_changes: [
				{ file_path: "/src/index.ts", status: "modified", additions: 10, deletions: 5 },
			],
		};

		const parentBacktracks: BacktrackResult[] = [
			makeBacktrack({ start_t: 5000, end_t: 6000, tool_name: "Edit", tool_use_ids: ["p-bt1"] }),
		];

		const parentReasoning: TranscriptReasoning[] = [
			{ t: 1000, thinking: "Planning the implementation approach" },
		];

		const parentCost = makeCostEstimate({
			model: "claude-opus-4-20250514",
			estimated_input_tokens: 10000,
			estimated_output_tokens: 5000,
			estimated_cost_usd: 1.0,
		});

		// -- Agent 1: builder with stats, file_map, edit_chains, backtracks --
		const agent1 = makeAgentNode({
			session_id: "agent-1",
			agent_name: "builder-types",
			agent_type: "builder",
			stats: makeAgentStats({
				tool_call_count: 12,
				failure_count: 3,
				unique_files: ["/src/types.ts", "/src/index.ts"],
				tools_by_name: { Read: 5, Edit: 4, Bash: 3 },
			}),
			file_map: {
				files: [
					makeFileMapEntry({
						file_path: "/src/types.ts",
						reads: 5,
						edits: 4,
						tool_use_ids: ["a1-1", "a1-2"],
					}),
					makeFileMapEntry({
						file_path: "/src/index.ts",
						reads: 2,
						edits: 1,
						tool_use_ids: ["a1-3"],
					}),
				],
			},
			edit_chains: {
				chains: [
					makeEditChain({ file_path: "/src/types.ts", total_edits: 4 }),
				],
			},
			backtracks: [
				makeBacktrack({ start_t: 2000, end_t: 3000, tool_name: "Edit", tool_use_ids: ["a1-bt1"] }),
			],
			reasoning: [
				{ t: 2000, thinking: "Checking type definitions" },
			],
			cost_estimate: makeCostEstimate({
				model: "claude-sonnet-4-20250514",
				estimated_input_tokens: 5000,
				estimated_output_tokens: 2000,
				estimated_cost_usd: 0.3,
			}),
		});

		// -- Agent 2: tester with stats and backtracks --
		const agent2 = makeAgentNode({
			session_id: "agent-2",
			agent_name: "tester-unit",
			agent_type: "tester",
			stats: makeAgentStats({
				tool_call_count: 7,
				failure_count: 1,
				unique_files: ["/test/app.test.ts"],
				tools_by_name: { Read: 2, Bash: 5 },
			}),
			file_map: {
				files: [
					makeFileMapEntry({
						file_path: "/test/app.test.ts",
						reads: 2,
						writes: 1,
						tool_use_ids: ["a2-1", "a2-2"],
					}),
				],
			},
			edit_chains: {
				chains: [
					makeEditChain({ file_path: "/test/app.test.ts", total_edits: 1 }),
				],
			},
			backtracks: [
				makeBacktrack({ start_t: 8000, end_t: 9000, type: "debugging_loop", tool_name: "Bash", tool_use_ids: ["a2-bt1"] }),
			],
			reasoning: [
				{ t: 7000, thinking: "Running tests and analyzing failures" },
			],
			cost_estimate: makeCostEstimate({
				model: "claude-sonnet-4-20250514",
				estimated_input_tokens: 3000,
				estimated_output_tokens: 1500,
				estimated_cost_usd: 0.15,
			}),
		});

		const result = aggregateTeamData({
			parentStats,
			parentFileMap,
			parentEditChains,
			parentBacktracks,
			parentReasoning,
			parentCost,
			agents: [agent1, agent2],
		});

		// -- stats --
		// tool_call_count: 6 + 12 + 7 = 25
		expect(result.stats.tool_call_count).toBe(25);
		// failure_count: 1 + 3 + 1 = 5
		expect(result.stats.failure_count).toBe(5);
		// failure_rate: 5 / 25 = 0.2
		expect(result.stats.failure_rate).toBe(0.2);
		// unique_files: union
		const uniqueSorted = [...result.stats.unique_files].sort();
		expect(uniqueSorted).toEqual(["/src/index.ts", "/src/types.ts", "/test/app.test.ts"]);
		// tools_by_name merged
		expect(result.stats.tools_by_name.Read).toBe(11); // 4 + 5 + 2
		expect(result.stats.tools_by_name.Edit).toBe(6);  // 2 + 4
		expect(result.stats.tools_by_name.Bash).toBe(8);  // 3 + 5
		// parent duration preserved
		expect(result.stats.duration_ms).toBe(15000);

		// -- file_map --
		// /src/index.ts: parent (reads:4, edits:2) + agent1 (reads:2, edits:1) = reads:6, edits:3
		const indexEntry = result.file_map.files.find((f) => f.file_path === "/src/index.ts");
		expect(indexEntry).toBeDefined();
		expect(indexEntry?.reads).toBe(6);
		expect(indexEntry?.edits).toBe(3);
		// /src/types.ts from agent1
		const typesEntry = result.file_map.files.find((f) => f.file_path === "/src/types.ts");
		expect(typesEntry).toBeDefined();
		expect(typesEntry?.reads).toBe(5);
		expect(typesEntry?.edits).toBe(4);
		// /test/app.test.ts from agent2
		const testEntry = result.file_map.files.find((f) => f.file_path === "/test/app.test.ts");
		expect(testEntry).toBeDefined();
		expect(testEntry?.writes).toBe(1);

		// -- edit_chains --
		// Parent chain + agent1 chain + agent2 chain = 3
		expect(result.edit_chains.chains).toHaveLength(3);
		// Parent chain has no agent_name
		expect(result.edit_chains.chains[0].agent_name).toBeUndefined();
		// Agent chains have agent names
		expect(result.edit_chains.chains[1].agent_name).toBe("builder-types");
		expect(result.edit_chains.chains[2].agent_name).toBe("tester-unit");
		// net_changes from parent
		expect(result.edit_chains.net_changes).toHaveLength(1);
		expect(result.edit_chains.net_changes?.[0].file_path).toBe("/src/index.ts");

		// -- backtracks --
		// parent (5000) + agent1 (2000) + agent2 (8000), sorted by start_t
		expect(result.backtracks).toHaveLength(3);
		expect(result.backtracks[0].start_t).toBe(2000);
		expect(result.backtracks[1].start_t).toBe(5000);
		expect(result.backtracks[2].start_t).toBe(8000);

		// -- reasoning --
		// parent (1) + agent1 (1) + agent2 (1) = 3
		expect(result.reasoning).toHaveLength(3);
		expect(result.reasoning[0].t).toBe(1000);
		expect(result.reasoning[1].t).toBe(2000);
		expect(result.reasoning[2].t).toBe(7000);

		// -- cost_estimate --
		// 10000 + 5000 + 3000 = 18000 input
		expect(result.cost_estimate?.estimated_input_tokens).toBe(18000);
		// 5000 + 2000 + 1500 = 8500 output
		expect(result.cost_estimate?.estimated_output_tokens).toBe(8500);
		// 1.0 + 0.3 + 0.15 = 1.45
		expect(result.cost_estimate?.estimated_cost_usd).toBe(1.45);
		// Model from parent
		expect(result.cost_estimate?.model).toBe("claude-opus-4-20250514");
	});

	test("agents with missing optional fields still aggregate correctly", () => {
		const parentStats = makeStatsResult({ tool_call_count: 2, failure_count: 0 });
		const parentFileMap: FileMapResult = { files: [] };
		const parentEditChains: EditChainsResult = { chains: [] };
		const parentBacktracks: BacktrackResult[] = [];
		const parentReasoning: TranscriptReasoning[] = [];

		// Agent with no optional distill data
		const sparseAgent = makeAgentNode({
			session_id: "sparse-1",
			agent_name: "sparse-builder",
			// no stats, no file_map, no edit_chains, no backtracks, no reasoning, no cost_estimate
		});

		const result = aggregateTeamData({
			parentStats,
			parentFileMap,
			parentEditChains,
			parentBacktracks,
			parentReasoning,
			parentCost: undefined,
			agents: [sparseAgent],
		});

		// Stats remain as parent (no agent stats to merge)
		expect(result.stats.tool_call_count).toBe(2);
		expect(result.file_map.files).toHaveLength(0);
		expect(result.edit_chains.chains).toHaveLength(0);
		expect(result.backtracks).toHaveLength(0);
		expect(result.reasoning).toHaveLength(0);
		// cost_estimate: agent has undefined, parent is undefined => undefined
		expect(result.cost_estimate).toBeUndefined();
	});

	test("nested agents are flattened and aggregated", () => {
		const parentStats = makeStatsResult({ tool_call_count: 1 });
		const parentFileMap: FileMapResult = { files: [] };
		const parentEditChains: EditChainsResult = { chains: [] };

		const grandchild = makeAgentNode({
			session_id: "gc-1",
			agent_name: "grandchild-builder",
			stats: makeAgentStats({
				tool_call_count: 5,
				failure_count: 0,
				unique_files: ["/deep/file.ts"],
				tools_by_name: { Edit: 5 },
			}),
		});

		const child = makeAgentNode({
			session_id: "c-1",
			agent_name: "child-lead",
			children: [grandchild],
			stats: makeAgentStats({
				tool_call_count: 3,
				failure_count: 1,
				unique_files: ["/mid/file.ts"],
				tools_by_name: { Read: 3 },
			}),
		});

		const result = aggregateTeamData({
			parentStats,
			parentFileMap,
			parentEditChains,
			parentBacktracks: [],
			parentReasoning: [],
			parentCost: undefined,
			agents: [child],
		});

		// tool_call_count: 1 (parent) + 3 (child) + 5 (grandchild) = 9
		expect(result.stats.tool_call_count).toBe(9);
		const uniqueSorted = [...result.stats.unique_files].sort();
		expect(uniqueSorted).toEqual(["/deep/file.ts", "/mid/file.ts"]);
	});

	test("agent without agent_name falls back to agent_type for edit chain tag", () => {
		const parentStats = makeStatsResult();
		const parentFileMap: FileMapResult = { files: [] };
		const parentEditChains: EditChainsResult = { chains: [] };

		const agent = makeAgentNode({
			session_id: "unnamed-agent-uuid",
			agent_type: "builder",
			// no agent_name
			edit_chains: {
				chains: [makeEditChain({ file_path: "/src/x.ts" })],
			},
		});

		const result = aggregateTeamData({
			parentStats,
			parentFileMap,
			parentEditChains,
			parentBacktracks: [],
			parentReasoning: [],
			parentCost: undefined,
			agents: [agent],
		});

		// The agent_name on the chain should fall back to agent_type (not raw session_id)
		expect(result.edit_chains.chains).toHaveLength(1);
		expect(result.edit_chains.chains[0].agent_name).toBe("builder");
	});
});
