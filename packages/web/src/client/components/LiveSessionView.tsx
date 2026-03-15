import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import type { LiveSessionState, LiveAgentState, PendingTool } from "../lib/live-store"
import { extractFilePath } from "../lib/live-store"
import { formatDuration } from "../lib/format"
import type { StoredEvent } from "../../shared/types"

// ── Helpers ─────────────────────────────────────────────────────────

const formatTime = (t: number): string => {
	const d = new Date(t)
	return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
}

// ── Event Config ────────────────────────────────────────────────────

const EVENT_CONFIG: Readonly<Record<string, {
	readonly label: string
	readonly color: string
	readonly icon: string
}>> = {
	SessionStart:       { label: "Session",    color: "text-blue-500",    icon: "S" },
	SessionEnd:         { label: "End",        color: "text-gray-500",    icon: "X" },
	UserPromptSubmit:   { label: "Prompt",     color: "text-violet-500",  icon: "U" },
	PreToolUse:         { label: "Tool",       color: "text-sky-500",     icon: "T" },
	PostToolUse:        { label: "Result",     color: "text-emerald-500", icon: "+" },
	PostToolUseFailure: { label: "Failure",    color: "text-red-500",     icon: "!" },
	SubagentStart:      { label: "Agent",      color: "text-purple-500",  icon: "A" },
	SubagentStop:       { label: "Agent End",  color: "text-purple-400",  icon: "a" },
	PermissionRequest:  { label: "Permission", color: "text-amber-500",   icon: "P" },
	Stop:               { label: "Stop",       color: "text-red-400",     icon: "X" },
	PreCompact:         { label: "Compact",    color: "text-gray-400",    icon: "C" },
	TaskCompleted:      { label: "Task",       color: "text-emerald-400", icon: "D" },
	TeammateIdle:       { label: "Idle",       color: "text-gray-400",    icon: "I" },
	InstructionsLoaded: { label: "Config",     color: "text-gray-400",    icon: "L" },
	ConfigChange:       { label: "Config",     color: "text-gray-400",    icon: "C" },
	Notification:       { label: "Notice",     color: "text-gray-400",    icon: "N" },
	WorktreeCreate:     { label: "Worktree",   color: "text-teal-500",    icon: "W" },
	WorktreeRemove:     { label: "Worktree",   color: "text-teal-400",    icon: "w" },
}

// ── Sub-components ──────────────────────────────────────────────────

const KpiChip: Component<{ readonly label: string; readonly value: string; readonly variant?: "danger" }> = (props) => (
	<div class="flex flex-col items-center">
		<span
			class="text-sm font-semibold tabular-nums"
			classList={{
				"text-primary": !props.variant,
				"text-red-600 dark:text-red-400": props.variant === "danger",
			}}
		>
			{props.value}
		</span>
		<span class="text-[10px] text-muted uppercase">{props.label}</span>
	</div>
)

const LiveHeader: Component<{ readonly state: LiveSessionState; readonly elapsed: number }> = (props) => (
	<div class="flex items-center gap-4 rounded-lg border border-clens bg-surface-raised shadow-card px-4 py-3">
		{/* Status indicator */}
		<div class="flex items-center gap-2">
			<Show
				when={props.state.status !== "complete"}
				fallback={<span class="h-2 w-2 rounded-full bg-gray-400" />}
			>
				<span class="relative flex h-2.5 w-2.5">
					<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
				</span>
			</Show>
			<span class="text-xs font-medium text-muted uppercase">
				{props.state.status}
			</span>
		</div>

		{/* KPI chips */}
		<KpiChip label="Duration" value={formatDuration(props.elapsed)} />
		<KpiChip label="Events" value={String(props.state.event_count)} />
		<KpiChip label="Tools" value={String(props.state.tool_call_count)} />
		<KpiChip label="Agents" value={String(props.state.agents.size)} />
		<KpiChip label="Files" value={String(props.state.files_touched.size)} />
		<Show when={props.state.failure_count > 0}>
			<KpiChip label="Failures" value={String(props.state.failure_count)} variant="danger" />
		</Show>

		{/* Model + branch */}
		<div class="ml-auto flex items-center gap-3 text-xs text-muted">
			<Show when={props.state.model}>
				<span>{props.state.model}</span>
			</Show>
			<Show when={props.state.git_branch}>
				<span class="font-mono">{props.state.git_branch}</span>
			</Show>
		</div>
	</div>
)

const AgentTreeSection: Component<{ readonly agents: ReadonlyMap<string, LiveAgentState> }> = (props) => (
	<div class="rounded-lg border border-clens bg-surface-raised shadow-card p-3">
		<h3 class="text-xs font-medium text-muted uppercase mb-2">Agents</h3>
		<Show
			when={props.agents.size > 0}
			fallback={<span class="text-xs text-gray-400">Solo session</span>}
		>
			<div class="flex flex-col gap-1.5">
				<For each={[...props.agents.values()]}>
					{(agent) => (
						<div class="flex items-center gap-2 text-xs">
							<span
								class="h-1.5 w-1.5 rounded-full shrink-0"
								classList={{
									"bg-emerald-500": agent.status === "running",
									"bg-gray-400": agent.status === "stopped",
								}}
							/>
							<span class="truncate text-secondary">
								{agent.agent_name ?? agent.agent_id.slice(0, 8)}
							</span>
							<span class="ml-auto text-muted">
								{agent.agent_type}
							</span>
						</div>
					)}
				</For>
			</div>
		</Show>
	</div>
)

const FilesSection: Component<{ readonly files: ReadonlyMap<string, number> }> = (props) => {
	const sorted = createMemo(() =>
		[...props.files.entries()]
			.sort(([, a], [, b]) => b - a)
			.slice(0, 20)
	)

	return (
		<div class="rounded-lg border border-clens bg-surface-raised shadow-card p-3">
			<h3 class="text-xs font-medium text-muted uppercase mb-2">
				Files ({props.files.size})
			</h3>
			<div class="flex flex-col gap-1">
				<For each={sorted()}>
					{([path, count]) => (
						<div class="flex items-center gap-2 text-xs">
							<span class="truncate text-secondary font-mono flex-1" title={path}>
								{path.split("/").pop()}
							</span>
							<span class="text-muted tabular-nums shrink-0">
								({count})
							</span>
						</div>
					)}
				</For>
			</div>
		</div>
	)
}

const extractDetail = (event: StoredEvent): string => {
	const d = event.data
	switch (event.event) {
		case "PreToolUse":
		case "PostToolUse":
		case "PostToolUseFailure": {
			const tool = typeof d.tool_name === "string" ? d.tool_name : ""
			const fp = extractFilePath(d)
			return fp ? `${tool}  ${fp.split("/").pop()}` : tool
		}
		case "UserPromptSubmit": {
			const text = typeof d.text === "string" ? d.text : ""
			return text.length > 80 ? text.slice(0, 77) + "..." : text
		}
		case "SubagentStart":
		case "SubagentStop": {
			const name = typeof d.agent_name === "string" ? d.agent_name : typeof d.agent_id === "string" ? d.agent_id.slice(0, 8) : ""
			return name
		}
		default:
			return ""
	}
}

const TimelineRow: Component<{ readonly event: StoredEvent }> = (props) => {
	const cfg = () => EVENT_CONFIG[props.event.event] ?? { label: props.event.event, color: "text-gray-400", icon: "?" }

	return (
		<div
			class="flex items-center gap-2 px-2 py-0.5 text-xs rounded hover:bg-surface-hover"
			classList={{
				"bg-red-50 dark:bg-red-950/30": props.event.event === "PostToolUseFailure",
			}}
		>
			<span class="w-16 text-muted tabular-nums shrink-0">
				{formatTime(props.event.t)}
			</span>
			<span class={`w-4 text-center font-mono font-bold shrink-0 ${cfg().color}`}>
				{cfg().icon}
			</span>
			<span class={`w-16 shrink-0 font-medium ${cfg().color}`}>
				{cfg().label}
			</span>
			<span class="text-secondary font-mono truncate">
				{extractDetail(props.event)}
			</span>
		</div>
	)
}

const LiveTimeline: Component<{
	readonly events: readonly StoredEvent[]
	readonly pendingTools: ReadonlyMap<string, PendingTool>
}> = (props) => {
	// Pragmatic exception: mutable ref for DOM element scrolling behavior
	let scrollRef: HTMLDivElement | undefined // eslint-disable-line prefer-const
	const [autoScroll, setAutoScroll] = createSignal(true)

	createEffect(() => {
		const _ = props.events.length
		if (autoScroll() && scrollRef) {
			requestAnimationFrame(() => {
				scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: "smooth" })
			})
		}
	})

	const handleScroll = () => {
		if (!scrollRef) return
		const nearBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 100
		setAutoScroll(nearBottom)
	}

	return (
		<div class="flex flex-col h-full rounded-lg border border-clens bg-surface-raised shadow-card">
			<div class="flex items-center justify-between px-3 py-2 border-b border-clens">
				<h3 class="text-xs font-medium text-muted uppercase">
					Live Timeline
				</h3>
				<Show when={!autoScroll()}>
					<button
						class="text-[10px] text-blue-500 hover:text-blue-600"
						onClick={() => {
							setAutoScroll(true)
							scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: "smooth" })
						}}
					>
						Jump to latest
					</button>
				</Show>
			</div>

			<div
				ref={(el) => {
					scrollRef = el
					el.addEventListener("scroll", handleScroll, { passive: true })
					onCleanup(() => el.removeEventListener("scroll", handleScroll))
				}}
				class="flex-1 overflow-y-auto p-2 space-y-px"
			>
				<For each={props.events}>
					{(event) => <TimelineRow event={event} />}
				</For>

				<For each={[...props.pendingTools.entries()]}>
					{([_toolUseId, tool]) => (
						<div class="flex items-center gap-2 px-2 py-1 text-xs text-amber-600 dark:text-amber-400 animate-pulse">
							<span class="w-16 text-muted tabular-nums shrink-0">
								{formatTime(tool.started_at)}
							</span>
							<span class="h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent shrink-0" />
							<span class="font-medium">{tool.name}</span>
							<Show when={tool.file_path}>
								<span class="text-gray-400 font-mono truncate">{tool.file_path}</span>
							</Show>
						</div>
					)}
				</For>
			</div>
		</div>
	)
}

const UserPromptsSection: Component<{ readonly prompts: readonly string[] }> = (props) => (
	<div class="rounded-lg border border-clens bg-surface-raised shadow-card p-3">
		<h3 class="text-xs font-medium text-muted uppercase mb-2">
			User Prompts ({props.prompts.length})
		</h3>
		<div class="flex flex-col gap-1.5">
			<For each={props.prompts}>
				{(prompt, i) => (
					<div class="flex gap-2 text-xs">
						<span class="text-muted shrink-0">{i() + 1}.</span>
						<span class="text-secondary line-clamp-2">{prompt}</span>
					</div>
				)}
			</For>
		</div>
	</div>
)

// ── Main Component ──────────────────────────────────────────────────

type LiveSessionViewProps = {
	readonly state: LiveSessionState
	readonly elapsed: number
}

const LiveSessionView: Component<LiveSessionViewProps> = (props) => (
	<div class="flex flex-col gap-3 p-4">
		<LiveHeader state={props.state} elapsed={props.elapsed} />

		<div class="flex gap-3" style={{ height: "calc(100vh - 250px)" }}>
			<div class="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">
				<AgentTreeSection agents={props.state.agents} />
				<FilesSection files={props.state.files_touched} />
			</div>

			<div class="flex-1 overflow-hidden">
				<LiveTimeline
					events={props.state.recent_events}
					pendingTools={props.state.pending_tools}
				/>
			</div>
		</div>

		<Show when={props.state.user_prompts.length > 0}>
			<UserPromptsSection prompts={props.state.user_prompts} />
		</Show>
	</div>
)

export { LiveSessionView }
