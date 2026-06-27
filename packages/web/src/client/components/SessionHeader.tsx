import { Show, createSignal, type Component } from "solid-js";
import { Pencil } from "lucide-solid";
import type { ColorName, DistilledSession, SessionStatus, SessionSummary } from "../../shared/types";
import { StatusBadge } from "./ui/StatusBadge";
import { ColorFlag } from "./ui/ColorFlag";
import { setSessionMeta } from "../lib/stores";
import { DetailHeader } from "./DetailHeader";

// -- Types ----------------------------------------------------------------

type SessionHeaderProps = {
	readonly session: DistilledSession;
	// Raw-derived live status from the session list (bug B5/B6). When provided it
	// is authoritative over the distilled `complete` flag, which is frozen at
	// distill time and goes stale while a live session keeps running.
	readonly status?: SessionStatus;
	// Lightweight list row for this session — carries the resolved
	// display_name/label/color (sidecar-backed) the distilled snapshot lacks.
	// When present, the header renders rename + color controls (R18); absent, it
	// falls back to the distilled session_name with no controls.
	readonly summary?: SessionSummary;
	readonly onRedistill?: () => Promise<void>;
};

// -- Display-name resolution ---------------------------------------------

const resolveTitle = (props: SessionHeaderProps): string =>
	props.summary?.display_name
	?? props.session.session_name
	?? props.session.session_id.slice(0, 12);

// -- Component ------------------------------------------------------------

export const SessionHeader: Component<SessionHeaderProps> = (props) => {
	const [distilling, setDistilling] = createSignal(false);
	const [editing, setEditing] = createSignal(false);
	const [draft, setDraft] = createSignal("");
	let inputRef: HTMLInputElement | undefined;

	const sessionId = () => props.session.session_id;
	const flag = (): ColorName => props.summary?.color ?? "none";

	const beginEdit = () => {
		// Seed with the stored custom label only, so an untouched save is a no-op
		// rather than freezing a computed/custom-title name as a label.
		setDraft(props.summary?.label ?? "");
		setEditing(true);
		queueMicrotask(() => inputRef?.focus());
	};

	const commit = () => {
		if (!editing()) return;
		setEditing(false);
		const trimmed = draft().trim();
		const currentLabel = (props.summary?.label ?? "").trim();
		if (trimmed === currentLabel) return;
		// Blank clears the label (R7/R8); otherwise set it (R6).
		void setSessionMeta(sessionId(), { label: trimmed.length > 0 ? trimmed : null });
	};

	const cancel = () => {
		setEditing(false);
		setDraft("");
	};

	return (
		<DetailHeader
			title={resolveTitle(props)}
			action={
				<Show when={props.onRedistill}>
					<button
						onClick={async () => {
							setDistilling(true);
							try { await props.onRedistill?.(); }
							finally { setDistilling(false); }
						}}
						disabled={distilling()}
						class="instrument-microcaps rounded-none border border-clens bg-surface-inset px-2 py-1 text-[10px] text-secondary transition hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{distilling() ? "Re-analyzing..." : "Re-analyze"}
					</button>
				</Show>
			}
		>
			{/* Rename + color controls (R18) — only when the list row is available */}
			<Show when={props.summary}>
				<ColorFlag value={flag()} onChange={(color) => void setSessionMeta(sessionId(), { color })} />
				<Show when={editing()}>
					<input
						ref={inputRef}
						type="text"
						value={draft()}
						placeholder="Name this session…"
						onInput={(e) => setDraft(e.currentTarget.value)}
						onKeyDown={(e: KeyboardEvent) => {
							if (e.key === "Enter") { e.preventDefault(); commit(); }
							else if (e.key === "Escape") { e.preventDefault(); cancel(); }
						}}
						onBlur={commit}
						class="w-64 rounded-none border border-brand-500 bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-primary focus:outline-none"
					/>
				</Show>
				<Show when={!editing()}>
					<button
						type="button"
						onClick={beginEdit}
						class="rounded-none p-0.5 text-muted transition hover:text-brand-500"
						title="Rename session"
						aria-label="Rename session"
					>
						<Pencil class="h-3.5 w-3.5" />
					</button>
				</Show>
			</Show>

			<Show
				when={props.status}
				fallback={<StatusBadge complete={props.session.complete} />}
			>
				{(status) => <StatusBadge status={status()} />}
			</Show>
		</DetailHeader>
	);
};
