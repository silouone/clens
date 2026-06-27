import { createMemo, For, Show, type Component, type JSX } from "solid-js";
import { CommunicationTimeline } from "../CommunicationTimeline";
import { AgentGraph, HorizontalBar, categoricalColor } from "../charts";
import type { AgentGraphNode, AgentGraphEdge } from "../charts";
import { StatTile } from "../ui/StatTile";
import { CATEGORY, type CategoryKey } from "../../lib/categories";
import { formatDuration } from "../../lib/format";
import type { TabProps } from "./types";

// ── CommunicationTab — Wave 2 rework (overview-moat-refactor) ─────────
//
// W5/R-C4/AC9: the old tab was a single flat swimlane that surfaced no shape.
// The rework leads with an AgentGraph (hub-and-spoke topology sized by activity)
// + a team headline + an activity leaderboard, then keeps the swimlane timeline
// as a SECONDARY view below.
//
// The honest insight for a real run (rich fixture: 133 agents, 5 messages) is
// the ASYMMETRY — broad fan-out, near-zero cross-talk. So spawn structure and
// real messages are kept as two strictly separate channels (AgentGraph), and
// the headline states both counts plainly (R-D). Activity is sourced by joining
// agent_lifetimes (names/spans) with the agents tree (`tool_call_count`); the
// hub is a synthetic role marker with NO fabricated size.
//
// R-E2: a single-agent session (no team data) shows a deliberate repurposed
// state instead of an empty graph shell.

// ── Minimal structural agent-tree node (avoid coupling to full AgentNode) ──
type FlatAgent = {
	readonly session_id: string;
	readonly agent_type: string;
	readonly tool_call_count: number;
	readonly duration_ms: number;
	readonly children: readonly FlatAgent[];
};

type RosterEntry = {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly tools: number;
	readonly durationMs: number;
	/** Activity metric driving node size & leaderboard order (tools, else seconds). */
	readonly weight: number;
};

// Flatten an agent forest (root + descendants).
const flattenAgents = (nodes: readonly FlatAgent[]): readonly FlatAgent[] =>
	nodes.flatMap((n) => [n, ...flattenAgents(n.children ?? [])]);

// ── Local instrument panel (matches the Widget header idiom, non-clickable) ──
const TabPanel: Component<{
	readonly category: CategoryKey;
	readonly title: string;
	readonly headerRight?: JSX.Element;
	readonly children: JSX.Element;
}> = (props) => {
	const meta = () => CATEGORY[props.category];
	return (
		<div class={`rounded-none border border-clens bg-surface-raised ${meta().ruleClass}`}>
			<div class="flex items-center justify-between gap-2 border-b border-clens px-3 py-2">
				<div class="flex items-center gap-2" style={{ color: meta().cssVar }}>
					{(() => {
						const Icon = meta().icon;
						return <Icon class="h-3.5 w-3.5" />;
					})()}
					<h3 class="instrument-microcaps text-[11px]">{props.title}</h3>
				</div>
				<Show when={props.headerRight}>{props.headerRight}</Show>
			</div>
			<div class="p-3">{props.children}</div>
		</div>
	);
};

export const CommunicationTab: Component<TabProps> = (props) => {
	const session = () => props.session;

	const lifetimes = () => session().agent_lifetimes ?? [];
	const flatAgents = createMemo<readonly FlatAgent[]>(() =>
		flattenAgents(session().agents ?? []),
	);
	const byId = createMemo(() => new Map(flatAgents().map((a) => [a.session_id, a])));

	// B15 count precedence: flattened agents tree → lifetimes → team_metrics, so
	// this never disagrees with the Overview AgentsWidget.
	const agentCount = () => {
		const tree = flatAgents().length;
		if (tree > 0) return tree;
		const lt = lifetimes().length;
		if (lt > 0) return lt;
		return session().team_metrics?.agent_count ?? 0;
	};

	const messageCount = () => session().comm_sequence?.length ?? 0;
	const tasksDone = () => session().team_metrics?.task_completed_count ?? 0;

	// Treat as a team view when there is genuine multi-agent signal (prop OR data),
	// so the graph never renders for a lone session.
	const isTeam = () =>
		props.isMultiAgent || agentCount() > 1 || messageCount() > 0;

	// Roster: prefer lifetimes (names + spans), enriched with tree activity; fall
	// back to the flattened tree when lifetimes are absent.
	const roster = createMemo<readonly RosterEntry[]>(() => {
		const lts = lifetimes();
		if (lts.length > 0)
			return lts.map((l) => {
				const node = byId().get(l.agent_id);
				const tools = node?.tool_call_count ?? 0;
				const durationMs = Math.max(0, l.end_t - l.start_t);
				return {
					id: l.agent_id,
					name: l.agent_name ?? l.agent_id,
					type: l.agent_type,
					tools,
					durationMs,
					weight: tools > 0 ? tools : Math.round(durationMs / 1000),
				};
			});
		return flatAgents().map((a) => ({
			id: a.session_id,
			name: a.session_id,
			type: a.agent_type,
			tools: a.tool_call_count,
			durationMs: a.duration_ms,
			weight: a.tool_call_count > 0 ? a.tool_call_count : Math.round(a.duration_ms / 1000),
		}));
	});

	// Type "shape", high → low. Doubles as the stable color ranking + legend.
	const typeBreakdown = createMemo(() => {
		const counts = roster().reduce<ReadonlyMap<string, number>>(
			(acc, r) => new Map([...acc, [r.type, (acc.get(r.type) ?? 0) + 1]]),
			new Map(),
		);
		return [...counts.entries()]
			.map(([type, count]) => ({ type, count }))
			.sort((a, b) => b.count - a.count);
	});

	// Stable color per type, by rank (dominant type = primary green; the rare
	// standouts — builder / web-qa — take distinct tones so they pop).
	const colorFor = createMemo(() => {
		const ranked = new Map(typeBreakdown().map((t, i) => [t.type, categoricalColor(i)]));
		return (type: string): string => ranked.get(type) ?? "var(--clens-text-muted)";
	});

	const graphWorkers = createMemo<readonly AgentGraphNode[]>(() =>
		roster()
			.filter((r) => r.id !== session().session_id)
			.map((r) => ({ id: r.id, label: r.name, type: r.type, weight: r.weight })),
	);

	// Resolve every comm endpoint to the hub (synthetic orchestrator) or a worker
	// id, then aggregate to weighted edges. Verified on the rich fixture: 5 raw
	// leader→leader entries collapse to one hub self-loop (count 5).
	const graphEdges = createMemo<readonly AgentGraphEdge[]>(() => {
		const seq = session().comm_sequence ?? [];
		const sid = session().session_id;
		const isHub = (id: string, name: string) =>
			id === sid || id === "leader" || name === "leader";
		const resolve = (id: string, name: string) => (isHub(id, name) ? sid : id);
		const counts = seq.reduce<ReadonlyMap<string, AgentGraphEdge>>((acc, e) => {
			const from = resolve(e.from_id, e.from_name);
			const to = resolve(e.to_id, e.to_name);
			const key = `${from}\u0000${to}`;
			const prev = acc.get(key);
			return new Map([...acc, [key, { from, to, count: (prev?.count ?? 0) + 1 }]]);
		}, new Map());
		return [...counts.values()];
	});

	const topAgents = createMemo(() =>
		[...roster()].sort((a, b) => b.weight - a.weight).slice(0, 8),
	);

	// Headline tiles — Agents always; the rest only when non-zero (no "0" noise).
	const headlineTiles = createMemo<
		readonly { readonly label: string; readonly value: number; readonly category: CategoryKey }[]
	>(() =>
		[
			{ label: "Agents", value: agentCount(), category: "agents" as const },
			{ label: "Types", value: typeBreakdown().length, category: "agents" as const },
			{ label: "Messages", value: messageCount(), category: "comms" as const },
			{ label: "Tasks done", value: tasksDone(), category: "comms" as const },
		].filter((t) => t.label === "Agents" || t.value > 0),
	);

	return (
		<Show
			when={isTeam()}
			fallback={
				<div class="flex h-full flex-col items-center justify-center gap-2 p-6">
					{(() => {
						const Icon = CATEGORY.comms.icon;
						return <Icon class="h-5 w-5 text-muted" />;
					})()}
					<span class="instrument-microcaps text-[11px] text-muted">
						Single-agent session
					</span>
					<span class="text-sm text-muted">No inter-agent communication captured</span>
				</div>
			}
		>
			<div class="flex flex-col gap-3 p-3">
				{/* Team headline — the honest fan-out vs cross-talk asymmetry up front. */}
				<div>
					<div class="flex flex-wrap gap-2">
						<For each={headlineTiles()}>
							{(t) => <StatTile category={t.category} label={t.label} value={t.value} />}
						</For>
					</div>
					<p class="instrument-microcaps mt-1.5 text-[10px] text-muted">
						{agentCount()} agents · {messageCount()} captured message
						{messageCount() === 1 ? "" : "s"}
						<Show when={agentCount() >= 8 && messageCount() < agentCount() / 2}>
							{" "}— broad fan-out, sparse cross-talk
						</Show>
					</p>
				</div>

				{/* Primary — agent topology. */}
				<TabPanel
					category="comms"
					title="Agent topology"
					headerRight={
						<div class="instrument-microcaps flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted">
							<span class="flex items-center gap-1">
								<span
									class="inline-block h-2 w-2 rounded-[1px]"
									style={{ "background-color": CATEGORY.agents.cssVar }}
								/>
								orchestrator
							</span>
							<span class="flex items-center gap-1">
								<svg width="14" height="4" aria-hidden="true">
									<line x1="0" y1="2" x2="14" y2="2" stroke="var(--clens-tick)" stroke-width="1" />
								</svg>
								spawned
							</span>
							<span class="flex items-center gap-1">
								<svg width="14" height="4" aria-hidden="true">
									<line
										x1="0"
										y1="2"
										x2="14"
										y2="2"
										stroke={CATEGORY.comms.cssVar}
										stroke-width="2"
									/>
								</svg>
								message
							</span>
						</div>
					}
				>
					<AgentGraph
						hubId={session().session_id}
						hubLabel="leader"
						workers={graphWorkers()}
						edges={graphEdges()}
						colorFor={colorFor()}
						hubColor={CATEGORY.agents.cssVar}
						messageColor={CATEGORY.comms.cssVar}
						ariaLabel="Agent communication topology"
					/>

					{/* Type legend / shape — squares match the graph node colors. */}
					<Show when={typeBreakdown().length > 0}>
						<div class="instrument-microcaps mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-clens pt-2 text-[10px] text-muted">
							<For each={typeBreakdown()}>
								{(t) => (
									<span class="flex items-center gap-1.5">
										<span
											class="inline-block h-2.5 w-2.5 rounded-[1px]"
											style={{ "background-color": colorFor()(t.type) }}
										/>
										{t.type}
										<span class="font-mono tabular-nums text-secondary">{t.count}</span>
									</span>
								)}
							</For>
						</div>
					</Show>
				</TabPanel>

				{/* Activity leaderboard — top agents by tool activity. */}
				<Show when={topAgents().length > 0}>
					<TabPanel category="agents" title="Top agents by activity">
						<HorizontalBar
							data={topAgents()}
							label={(d) => `${d.type} · ${d.id.slice(0, 6)}`}
							value={(d) => d.weight}
							tooltipLabel={(d) =>
								`${d.name} · ${d.type} · ${d.tools} tools · ${formatDuration(d.durationMs)}`
							}
							color={CATEGORY.agents.cssVar}
							barHeight={16}
							ariaLabel="Top agents by activity"
						/>
					</TabPanel>
				</Show>

				{/* Secondary — the original swimlane message timeline (bounded height so
				    its internal scroll works inside the parent scroll flow). */}
				<TabPanel category="comms" title="Message timeline">
					<div class="h-[360px]">
						<CommunicationTimeline
							sequence={session().comm_sequence ?? []}
							lifetimes={lifetimes()}
							sessionStartTime={session().start_time ?? 0}
						/>
					</div>
				</TabPanel>
			</div>
		</Show>
	);
};
