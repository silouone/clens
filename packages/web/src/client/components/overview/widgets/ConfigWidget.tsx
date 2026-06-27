import { For, Show, type Component } from "solid-js";
import { Widget } from "../../ui/Widget";
import { MetaRow } from "../../ui/MetaRow";
import type { WidgetProps } from "../types";

// ── ConfigWidget [context] — Wave 1 ──────────────────────────────────
//
// "What was this session actually run with?" — the environmental context the
// run executed in: model, effort, permission posture, and the MCP servers whose
// tools were actually invoked. All values are purely derived from the event
// stream (zero-I/O SessionConfig scan), so only fields that were truly captured
// are shown — never a fabricated "default" (R-D1/R-D4).
//
// Honesty (R-E1/R-D4): the host guards on `session_config` PRESENCE, but
// `extractSessionConfig` always returns an object, so an otherwise-bare config
// (no mode/effort, empty mcp_servers, no model) would slip through. We re-check
// `hasSignal` and empty-state rather than paint an empty colored shell.
//
// Verbatim ids (R-D2): the model id is rendered verbatim; the context-window
// variant suffix (e.g. `[1m]`) is split off into a chip rather than mangled or
// reinterpreted. No click-through (context has no sibling tab).

// Type off the field so this tracks the CLI SessionConfig contract without an
// extra named import hop (the barrel re-exports it as part of DistilledSession).
type SessionConfig = NonNullable<WidgetProps["session"]["session_config"]>;
type McpServerUsage = SessionConfig["mcp_servers"][number];

// ── Pure helpers ─────────────────────────────────────────────────────

// Relaxed permission postures drop the operator's guardrails → amber (warning)
// LED; default/plan/acceptEdits stay signal-green (safe/ok). Maps to the locked
// palette: amber = warning, signal-green = ok/active.
const RELAXED_MODES: ReadonlySet<string> = new Set(["bypassPermissions", "dontAsk"]);
const isRelaxedPermission = (mode: string): boolean => RELAXED_MODES.has(mode);

// The hook-supplied model id carries a context-window suffix (e.g.
// `claude-opus-4-8[1m]`) the transcript drops. Surface it as a small chip
// rather than inline noise — the bare id stays verbatim (R-D2).
const SUFFIX_PATTERN = /\[(\d+m)\]\s*$/i;
const parseModel = (
	model: string | undefined,
): { readonly id?: string; readonly suffix?: string } => {
	if (!model) return {};
	const match = SUFFIX_PATTERN.exec(model);
	if (!match) return { id: model };
	return { id: model.replace(SUFFIX_PATTERN, "").trim(), suffix: match[1].toUpperCase() };
};

// Whether the panel has any signal worth rendering. `model` lives on stats (not
// session_config); mcp_servers is always present (possibly empty).
const hasSignal = (config: SessionConfig, model: string | undefined): boolean =>
	Boolean(model) ||
	Boolean(config.permission_mode) ||
	Boolean(config.effort) ||
	config.mcp_servers.length > 0;

// ── Sub-components ────────────────────────────────────────────────────

const ModelRow: Component<{ readonly model: string }> = (props) => {
	const parsed = () => parseModel(props.model);
	return (
		<div class="flex items-center justify-between gap-2 text-xs">
			<span class="instrument-microcaps text-[10px] text-muted">Model</span>
			<span class="inline-flex items-center gap-1.5 text-right font-mono tabular-nums text-secondary">
				{parsed().id}
				<Show when={parsed().suffix}>
					{(suffix) => (
						<span class="rounded-none border border-clens px-1 text-[9px] text-muted">
							{suffix()}
						</span>
					)}
				</Show>
			</span>
		</div>
	);
};

const PermissionRow: Component<{ readonly mode: string }> = (props) => (
	<div class="flex items-center justify-between text-xs">
		<span class="instrument-microcaps text-[10px] text-muted">Permission</span>
		<span class="inline-flex items-center gap-1.5 text-right font-mono tabular-nums text-secondary">
			<span
				class={`instrument-led ${
					isRelaxedPermission(props.mode)
						? "bg-[var(--clens-warning)]"
						: "bg-[var(--clens-success)]"
				}`}
			/>
			{props.mode}
		</span>
	</div>
);

const McpServerRow: Component<{ readonly server: McpServerUsage }> = (props) => (
	<div class="flex items-center justify-between gap-2 text-xs">
		{/* Server names are identifiers → mono, never microcaps-uppercased. */}
		<span class="truncate font-mono text-secondary" title={props.server.name}>
			{props.server.name}
		</span>
		<span class="shrink-0 font-mono tabular-nums text-muted">{props.server.count}</span>
	</div>
);

// ── Component ─────────────────────────────────────────────────────────

export const ConfigWidget: Component<WidgetProps> = (props) => {
	const config = () => props.session.session_config;
	const model = () => props.session.stats.model;

	return (
		<Widget category="context" title="Config / Environment" span={6}>
			<Show
				when={config()}
				fallback={<p class="text-xs italic text-muted">No config captured</p>}
			>
				{(cfg) => (
					<Show
						when={hasSignal(cfg(), model())}
						fallback={<p class="text-xs italic text-muted">No config captured</p>}
					>
						<div class="space-y-3">
							{/* Runtime */}
							<div class="space-y-1">
								<Show when={model()}>{(m) => <ModelRow model={m()} />}</Show>
								<Show when={cfg().effort}>
									{(effort) => <MetaRow label="Effort" value={effort()} />}
								</Show>
								<Show when={cfg().permission_mode}>
									{(mode) => <PermissionRow mode={mode()} />}
								</Show>
							</div>

							{/* Extensions — MCP servers (or an explicit "none used") */}
							<div class="space-y-1 border-t border-clens pt-2">
								<h4 class="instrument-microcaps text-[10px] text-muted">
									MCP servers
								</h4>
								<Show
									when={cfg().mcp_servers.length > 0}
									fallback={
										<p class="instrument-microcaps text-[10px] text-muted">
											None used
										</p>
									}
								>
									<div class="space-y-1">
										<For each={cfg().mcp_servers}>
											{(server) => <McpServerRow server={server} />}
										</For>
									</div>
								</Show>
							</div>
						</div>
					</Show>
				)}
			</Show>
		</Widget>
	);
};
