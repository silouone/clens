import {
	createSignal,
	For,
	Match,
	onCleanup,
	Show,
	Switch,
	type Component,
} from "solid-js";
import {
	AlertTriangle,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Milestone,
	Send,
	Terminal,
	User,
	X,
} from "lucide-solid";
import { createConversationStore } from "../lib/stores";
import type { ConversationEntry } from "../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import { Badge } from "./ui/Badge";
import { Spinner } from "./ui/Spinner";

/** Render markdown string to sanitized HTML */
const renderMd = renderMarkdown;

// ── Types ────────────────────────────────────────────────────────────

type ConversationPanelProps = {
	readonly sessionId: string;
};

// ── Helpers ──────────────────────────────────────────────────────────

const formatTimestamp = (t: number): string => {
	const d = new Date(t);
	return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const INTENT_VARIANT: Readonly<Record<string, "info" | "warning" | "success" | "default">> = {
	planning: "info",
	debugging: "warning",
	deciding: "info",
	research: "success",
	general: "default",
};

const intentVariant = (intent: string) =>
	INTENT_VARIANT[intent] ?? "default";

const truncate = (text: string, max: number): string =>
	text.length > max ? `${text.slice(0, max)}...` : text;

// ── User prompt content parsing ─────────────────────────────────────

type TeammateMessage = {
	readonly teammate_id: string;
	readonly color: string;
	readonly summary?: string;
	readonly content: string;
};

type CommandInvocation = {
	readonly command_name: string;
	readonly command_message: string;
	readonly command_args: string;
};

type TextSegment =
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "teammate"; readonly msg: TeammateMessage }
	| { readonly kind: "command"; readonly cmd: CommandInvocation };

const ATTR_RE = /(\w+)="([^"]*)"/g;

/** Tags to strip entirely (system metadata, not user-visible) */
const SYSTEM_TAG_RE = /<(?:system-reminder|antml_thinking|available-deferred-tools|context-window-status)[^>]*>[\s\S]*?<\/(?:system-reminder|antml_thinking|available-deferred-tools|context-window-status)>/g;

/** Command invocation block: <command-name>...</command-name> with optional siblings */
const COMMAND_BLOCK_RE = /<command-message>([\s\S]*?)<\/command-message>\s*<command-name>([\s\S]*?)<\/command-name>\s*<command-args>([\s\S]*?)<\/command-args>/g;
const COMMAND_BLOCK_RE2 = /<command-name>([\s\S]*?)<\/command-name>\s*<command-message>([\s\S]*?)<\/command-message>\s*<command-args>([\s\S]*?)<\/command-args>/g;

/** Teammate message */
const TEAMMATE_RE = /<teammate-message\s+([^>]*)>([\s\S]*?)<\/teammate-message>/g;

/** Catch-all for any remaining unrecognized XML-like tags */
const STRAY_TAG_RE = /<\/?(?:command-name|command-message|command-args|system-reminder|antml_thinking)[^>]*>/g;

const parseUserPromptSegments = (raw: string): readonly TextSegment[] => {
	// Phase 1: strip system tags
	const text = raw.replace(SYSTEM_TAG_RE, "");

	// Phase 2: extract command blocks
	const commands = [COMMAND_BLOCK_RE, COMMAND_BLOCK_RE2].flatMap((re) =>
		[...text.matchAll(re)].map((m) => {
			const isReversed = re === COMMAND_BLOCK_RE;
			return {
				index: m.index ?? 0,
				length: m[0].length,
				segment: {
					kind: "command" as const,
					cmd: {
						command_message: (isReversed ? m[1] : m[2]).trim(),
						command_name: (isReversed ? m[2] : m[1]).trim(),
						command_args: m[3].trim(),
					},
				},
			};
		}),
	);

	// Phase 3: extract teammate messages
	const teammates = [...text.matchAll(TEAMMATE_RE)].map((m) => {
		const attrs = Object.fromEntries([...m[1].matchAll(ATTR_RE)].map((a) => [a[1], a[2]]));
		return {
			index: m.index ?? 0,
			length: m[0].length,
			segment: {
				kind: "teammate" as const,
				msg: {
					teammate_id: attrs.teammate_id ?? "unknown",
					color: attrs.color ?? "gray",
					summary: attrs.summary,
					content: m[2].trim(),
				},
			},
		};
	});

	// Phase 4: merge all parsed spans sorted by position, then interleave with text gaps
	type Span = { readonly index: number; readonly length: number; readonly segment: TextSegment };
	const spans: readonly Span[] = [...commands, ...teammates].sort((a, b) => a.index - b.index);

	const { segments, cursor: finalCursor } = spans.reduce<{ readonly segments: readonly TextSegment[]; readonly cursor: number }>(
		(acc, span) => {
			const before = text.slice(acc.cursor, span.index).replace(STRAY_TAG_RE, "").trim();
			return {
				segments: [...acc.segments, ...(before ? [{ kind: "text" as const, value: before }] : []), span.segment],
				cursor: span.index + span.length,
			};
		},
		{ segments: [], cursor: 0 },
	);

	const tail = text.slice(finalCursor).replace(STRAY_TAG_RE, "").trim();
	return tail ? [...segments, { kind: "text" as const, value: tail }] : segments;
};

const COLOR_MAP: Readonly<Record<string, string>> = {
	orange: "border-orange-400/50 bg-orange-950/20",
	pink: "border-pink-400/50 bg-pink-950/20",
	blue: "border-blue-400/50 bg-blue-950/20",
	green: "border-emerald-400/50 bg-emerald-950/20",
	purple: "border-violet-400/50 bg-violet-950/20",
	red: "border-red-400/50 bg-red-950/20",
};

const LABEL_COLOR_MAP: Readonly<Record<string, string>> = {
	orange: "text-orange-400",
	pink: "text-pink-400",
	blue: "text-blue-400",
	green: "text-emerald-400",
	purple: "text-violet-400",
	red: "text-red-400",
};

const isJsonContent = (s: string): boolean =>
	s.startsWith("{") || s.startsWith("[");

const TeammateCard: Component<{ readonly msg: TeammateMessage }> = (props) => {
	const borderClass = () => COLOR_MAP[props.msg.color] ?? "border-gray-500/50 bg-gray-950/20";
	const labelClass = () => LABEL_COLOR_MAP[props.msg.color] ?? "text-gray-400";

	return (
		<div class={`rounded-lg border px-3 py-2 ${borderClass()}`}>
			<div class="mb-1 flex items-center gap-2">
				<span class={`text-[10px] font-semibold uppercase tracking-wider ${labelClass()}`}>
					{props.msg.teammate_id}
				</span>
				<Show when={props.msg.summary}>
					{(s) => (
						<span class="text-[11px] text-gray-300">{s()}</span>
					)}
				</Show>
			</div>
			<Show
				when={!isJsonContent(props.msg.content)}
				fallback={
					<pre class="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-gray-500">
						{truncate(props.msg.content, 200)}
					</pre>
				}
			>
				<div class="prose-sm-dark whitespace-pre-wrap text-xs leading-relaxed text-gray-300" innerHTML={renderMd(props.msg.content)} />
			</Show>
		</div>
	);
};

const CommandCard: Component<{ readonly cmd: CommandInvocation }> = (props) => (
	<div class="flex items-center gap-2 rounded-lg border border-gray-600/40 bg-gray-900/40 px-3 py-1.5">
		<Terminal class="h-3 w-3 shrink-0 text-gray-400" />
		<span class="font-mono text-[11px] font-medium text-gray-300">{props.cmd.command_name.startsWith("/") ? props.cmd.command_name : `/${props.cmd.command_name}`}</span>
		<Show when={props.cmd.command_args}>
			<span class="truncate font-mono text-[11px] text-gray-500">{props.cmd.command_args}</span>
		</Show>
	</div>
);

// ── Entry renderers ──────────────────────────────────────────────────

const UserPromptRow: Component<{ readonly entry: ConversationEntry & { type: "user_prompt" } }> = (props) => {
	const segments = () => parseUserPromptSegments(props.entry.text);
	const hasStructured = () => segments().some((s) => s.kind !== "text");

	return (
		<div class="flex gap-3 py-3 ml-4 pl-4 border-l-2 border-l-blue-400 dark:border-l-blue-500">
			<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
				<User class="h-3 w-3 text-blue-600 dark:text-blue-400" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="mb-1 flex items-center gap-2">
					<span class="text-xs font-semibold text-blue-700 dark:text-blue-300">User</span>
					<span class="font-mono text-[10px] tabular-nums text-gray-400">{formatTimestamp(props.entry.t)}</span>
				</div>
				<Show
					when={hasStructured()}
					fallback={
						<div class="prose-sm-dark whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-gray-800 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-gray-200" innerHTML={renderMd(props.entry.text)} />
					}
				>
					<div class="flex flex-col gap-2">
						<For each={segments()}>
							{(seg) => (
								<Switch>
									<Match when={seg.kind === "text" && seg}>
										{(s) => (
											<div class="prose-sm-dark whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-gray-800 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-gray-200" innerHTML={renderMd((s() as TextSegment & { kind: "text" }).value)} />
										)}
									</Match>
									<Match when={seg.kind === "teammate" && seg}>
										{(s) => (
											<TeammateCard msg={(s() as TextSegment & { kind: "teammate" }).msg} />
										)}
									</Match>
									<Match when={seg.kind === "command" && seg}>
										{(s) => (
											<CommandCard cmd={(s() as TextSegment & { kind: "command" }).cmd} />
										)}
									</Match>
								</Switch>
							)}
						</For>
					</div>
				</Show>
			</div>
		</div>
	);
};

const ThinkingRow: Component<{ readonly entry: ConversationEntry & { type: "thinking" } }> = (props) => {
	const [expanded, setExpanded] = createSignal(false);
	const hasText = () => props.entry.text.trim().length > 0;

	return (
		<div class="flex gap-3 py-2 ml-4 pl-4 border-l-2 border-l-gray-300 dark:border-l-gray-700">
			<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted">
				<Brain class="h-3 w-3 text-muted" />
			</div>
			<div class="min-w-0 flex-1">
				<Show
					when={hasText()}
					fallback={
						<div class="flex items-center gap-2 text-xs text-muted">
							<Badge variant={intentVariant(props.entry.intent)}>{props.entry.intent}</Badge>
						</div>
					}
				>
					<button
						onClick={() => setExpanded((p) => !p)}
						class="flex w-full items-center gap-2 text-left text-xs text-muted hover:text-secondary"
					>
						<Badge variant={intentVariant(props.entry.intent)}>{props.entry.intent}</Badge>
						<span class="flex-1 truncate text-muted">
							{truncate(props.entry.text, 120)}
						</span>
						<Show when={expanded()} fallback={<ChevronRight class="h-3 w-3 shrink-0" />}>
							<ChevronDown class="h-3 w-3 shrink-0" />
						</Show>
					</button>
					<Show when={expanded()}>
						<div class="mt-1.5 whitespace-pre-wrap rounded border border-clens bg-surface-inset px-3 py-2 text-xs leading-relaxed text-secondary">
							{props.entry.text}
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
};

const ToolCallRow: Component<{ readonly entry: ConversationEntry & { type: "tool_call" } }> = (props) => (
	<div class="flex items-center gap-3 py-1.5 ml-8 pl-4 border-l-2 border-l-emerald-400 dark:border-l-emerald-600">
		<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
			<Terminal class="h-3 w-3 text-violet-600 dark:text-violet-400" />
		</div>
		<div class="flex min-w-0 flex-1 items-center gap-2">
			<span class="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
				{props.entry.tool_name}
			</span>
			<Show when={props.entry.file_path}>
				{(fp) => (
					<span class="truncate font-mono text-[11px] text-muted">
						{fp()}
					</span>
				)}
			</Show>
			<span class="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-gray-400">{formatTimestamp(props.entry.t)}</span>
		</div>
	</div>
);

const ToolResultRow: Component<{ readonly entry: ConversationEntry & { type: "tool_result" } }> = (props) => {
	const isSuccess = () => props.entry.outcome === "success";

	return (
		<div class="flex items-center gap-3 py-1 ml-8 pl-4 border-l-2 border-l-emerald-400 dark:border-l-emerald-600">
			<Show
				when={isSuccess()}
				fallback={
					<X class="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
				}
			>
				<Check class="h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
			</Show>
			<span class="font-mono text-[11px] text-muted">{props.entry.tool_name}</span>
			<Show when={props.entry.error}>
				{(err) => (
					<span class="truncate text-[11px] text-red-500 dark:text-red-400">
						{truncate(err(), 80)}
					</span>
				)}
			</Show>
		</div>
	);
};

const BacktrackRow: Component<{ readonly entry: ConversationEntry & { type: "backtrack" } }> = (props) => (
	<div class="flex items-center gap-3 py-2 ml-4 pl-4 border-l-2 border-l-amber-400">
		<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
			<AlertTriangle class="h-3 w-3 text-amber-600 dark:text-amber-400" />
		</div>
		<Badge variant="warning">{props.entry.backtrack_type}</Badge>
		<span class="text-xs text-muted">
			Attempt {props.entry.attempt}
		</span>
		<Show when={props.entry.reverted_tool_ids.length > 0}>
			<span class="text-[10px] text-gray-400">
				({props.entry.reverted_tool_ids.length} reverted)
			</span>
		</Show>
		<span class="ml-auto font-mono text-[10px] tabular-nums text-gray-400">{formatTimestamp(props.entry.t)}</span>
	</div>
);

const PhaseBoundaryRow: Component<{ readonly entry: ConversationEntry & { type: "phase_boundary" } }> = (props) => (
	<div class="flex items-center gap-3 py-3 ml-4 pl-4 border-l-2 border-l-amber-400">
		<div class="h-px flex-1 bg-surface-muted" />
		<div class="flex items-center gap-1.5">
			<Milestone class="h-3 w-3 text-gray-400" />
			<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
				{props.entry.phase_name}
			</span>
		</div>
		<div class="h-px flex-1 bg-surface-muted" />
	</div>
);

const AgentMessageRow: Component<{ readonly entry: ConversationEntry & { type: "agent_message" } }> = (props) => {
	const isSent = () => props.entry.direction === "sent";

	return (
		<div class="flex items-center gap-3 py-1.5 ml-4 pl-4 border-l-2 border-l-gray-300 dark:border-l-gray-700">
			<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30">
				<Send class="h-3 w-3 text-teal-600 dark:text-teal-400" classList={{ "rotate-180": !isSent() }} />
			</div>
			<span class="text-xs text-muted">
				{isSent() ? "Sent to" : "Received from"}{" "}
				<span class="font-medium text-secondary">{props.entry.partner}</span>
			</span>
			<Show when={props.entry.summary}>
				{(s) => <span class="truncate text-[11px] text-muted">{s()}</span>}
			</Show>
			<span class="ml-auto font-mono text-[10px] tabular-nums text-gray-400">{formatTimestamp(props.entry.t)}</span>
		</div>
	);
};

// ── Entry dispatcher ────────────────────────────────────────────────

const isType = <T extends ConversationEntry["type"]>(
	entry: ConversationEntry,
	type: T,
): (ConversationEntry & { readonly type: T }) | false =>
	entry.type === type ? (entry as ConversationEntry & { readonly type: T }) : false;

const ConversationEntryRow: Component<{ readonly entry: ConversationEntry }> = (props) => (
	<Switch>
		<Match when={isType(props.entry, "user_prompt")}>
			{(e) => <UserPromptRow entry={e()} />}
		</Match>
		<Match when={isType(props.entry, "thinking")}>
			{(e) => <ThinkingRow entry={e()} />}
		</Match>
		<Match when={isType(props.entry, "tool_call")}>
			{(e) => <ToolCallRow entry={e()} />}
		</Match>
		<Match when={isType(props.entry, "tool_result")}>
			{(e) => <ToolResultRow entry={e()} />}
		</Match>
		<Match when={isType(props.entry, "backtrack")}>
			{(e) => <BacktrackRow entry={e()} />}
		</Match>
		<Match when={isType(props.entry, "phase_boundary")}>
			{(e) => <PhaseBoundaryRow entry={e()} />}
		</Match>
		<Match when={isType(props.entry, "agent_message")}>
			{(e) => <AgentMessageRow entry={e()} />}
		</Match>
	</Switch>
);

// ── Main component ──────────────────────────────────────────────────

export const ConversationPanel: Component<ConversationPanelProps> = (props) => {
	const store = createConversationStore(() => props.sessionId);
	const [scrollRef, setScrollRef] = createSignal<HTMLDivElement | undefined>();

	// Infinite scroll: detect near bottom
	const handleScroll = () => {
		const el = scrollRef();
		if (!el || store.loading() || !store.hasMore()) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
		if (nearBottom) store.loadMore();
	};

	// Attach/detach scroll listener
	const attachListener = (el: HTMLDivElement) => {
		setScrollRef(el);
		el.addEventListener("scroll", handleScroll, { passive: true });
		onCleanup(() => el.removeEventListener("scroll", handleScroll));
	};

	return (
		<div class="flex h-full flex-col overflow-hidden">
			{/* Header bar */}
			<div class="flex items-center gap-2 border-b border-clens px-4 py-2">
				<h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500">Conversation</h2>
				<Show when={store.total() > 0}>
					<span class="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted">
						{store.total()} entries
					</span>
				</Show>
				<Show when={store.loading()}>
					<Spinner size="sm" />
				</Show>
			</div>

			{/* Scrollable entries */}
			<div
				ref={attachListener}
				class="flex-1 overflow-y-auto px-4"
			>
				<Show
					when={store.entries().length > 0}
					fallback={
						<Show when={!store.loading()}>
							<div class="flex h-32 items-center justify-center text-xs text-gray-400">
								No conversation data available
							</div>
						</Show>
					}
				>
					<div class="divide-y divide-clens">
						<For each={store.entries()}>
							{(entry) => <ConversationEntryRow entry={entry} />}
						</For>
					</div>
				</Show>

				{/* Load more indicator */}
				<Show when={store.loading() && store.entries().length > 0}>
					<div class="flex justify-center py-4">
						<Spinner size="sm" />
					</div>
				</Show>
			</div>
		</div>
	);
};
