import { type Component, For, Show } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { Card } from "./ui/Card";
import { MetaRow } from "./ui/MetaRow";

// -- Types ----------------------------------------------------------------

// Type the panel off the field on DistilledSession so it tracks the CLI's
// SessionConfig contract without an extra named import hop (the shared barrel
// re-exports the interface as part of DistilledSession already).
type SessionConfig = NonNullable<DistilledSession["session_config"]>;
type McpServerUsage = SessionConfig["mcp_servers"][number];

type ConfigEnvironmentProps = {
	readonly session: DistilledSession;
};

const SECTION_HEADING = "instrument-microcaps text-[10px] text-muted mb-1.5";

// -- Pure helpers ---------------------------------------------------------

// Relaxed permission postures drop the operator's guardrails, so they light an
// amber (warning) LED; default/plan/acceptEdits stay signal-green (safe/ok).
// Maps to the locked palette: amber = warning, signal-green = ok/active.
const RELAXED_MODES: ReadonlySet<string> = new Set(["bypassPermissions", "dontAsk"]);
const isRelaxedPermission = (mode: string): boolean => RELAXED_MODES.has(mode);

// The hook-supplied model id carries a context-window suffix (e.g.
// `claude-opus-4-8[1m]`) that the transcript drops. Surface it as a small chip
// rather than inline noise. Returns the bare model id + an optional suffix.
const SUFFIX_PATTERN = /\[(\d+m)\]\s*$/i;
const parseModel = (
	model: string | undefined,
): { readonly id?: string; readonly suffix?: string } => {
	if (!model) return {};
	const match = SUFFIX_PATTERN.exec(model);
	if (!match) return { id: model };
	return { id: model.replace(SUFFIX_PATTERN, "").trim(), suffix: match[1].toUpperCase() };
};

// Whether the panel has any signal worth rendering. mcp_servers is always
// present (possibly empty), so an otherwise-bare config renders nothing rather
// than an empty frame.
const hasSignal = (config: SessionConfig, model: string | undefined): boolean =>
	Boolean(model) ||
	Boolean(config.permission_mode) ||
	Boolean(config.effort) ||
	config.mcp_servers.length > 0;

// -- Sub-components --------------------------------------------------------

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

const ModelRow: Component<{ readonly model: string }> = (props) => {
	const parsed = () => parseModel(props.model);
	return (
		<div class="flex items-center justify-between text-xs">
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

const McpServerRow: Component<{ readonly server: McpServerUsage }> = (props) => (
	<div class="flex items-center justify-between gap-2 text-xs">
		{/* Server names are identifiers → mono, never microcaps-uppercased. */}
		<span class="truncate font-mono text-secondary" title={props.server.name}>
			{props.server.name}
		</span>
		<span class="shrink-0 font-mono tabular-nums text-muted">{props.server.count}</span>
	</div>
);

// -- Component ------------------------------------------------------------

/**
 * Config / Environment panel — answers "what was this session actually run
 * with?" from the purely-derived SessionConfig (zero-I/O distill scan): model,
 * permission posture, effort level, and the MCP servers whose tools were called.
 *
 * Honesty: only fields that were actually captured are shown — never a
 * fabricated "default". Sessions distilled before SessionConfig shipped have no
 * `session_config` and render nothing (graceful absence, not an error).
 *
 * OPEN-DECISION: the settings-snapshot tier (output style + derived TTS badge,
 * statusline, plugins, configured hooks, CLAUDE.md-in-effect) and the
 * permission-transition trail / staleness banners from the CFG design are not
 * present on the shipped SessionConfig shape, so those groupings are omitted
 * rather than rendered empty. Re-add the "Style / Output" column and banners
 * once SettingsSnapshot lands on SessionConfig.
 */
export const ConfigEnvironment: Component<ConfigEnvironmentProps> = (props) => {
	const config = () => props.session.session_config;
	const model = () => props.session.stats.model;

	return (
		<Show when={config()}>
			{(cfg) => (
				<Show when={hasSignal(cfg(), model())}>
					<Card title="CONFIG / ENVIRONMENT">
						<div class="grid grid-cols-1 md:grid-cols-2">
							{/* Runtime */}
							<div class="px-3 py-2 md:border-r border-clens">
								<h4 class={SECTION_HEADING}>Runtime</h4>
								<div class="space-y-1">
									<Show when={model()}>{(m) => <ModelRow model={m()} />}</Show>
									<Show when={cfg().effort}>
										{(effort) => <MetaRow label="Effort" value={effort()} />}
									</Show>
									<Show when={cfg().permission_mode}>
										{(mode) => <PermissionRow mode={mode()} />}
									</Show>
								</div>
							</div>

							{/* Extensions */}
							<div class="px-3 py-2">
								<h4 class={SECTION_HEADING}>MCP Servers</h4>
								<Show
									when={cfg().mcp_servers.length > 0}
									fallback={<p class="instrument-microcaps text-[10px] text-muted">None used</p>}
								>
									<div class="space-y-1">
										<For each={cfg().mcp_servers}>
											{(server) => <McpServerRow server={server} />}
										</For>
									</div>
								</Show>
							</div>
						</div>
					</Card>
				</Show>
			)}
		</Show>
	);
};
