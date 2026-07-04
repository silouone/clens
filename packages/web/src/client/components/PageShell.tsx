import { type Component, type JSX, Show } from "solid-js";
import { clearError, globalError } from "../lib/stores";
import { Spinner } from "./ui/Spinner";

// ── Error banner ────────────────────────────────────────────────────

export const ErrorBanner: Component<{
	readonly message: string;
	readonly onDismiss: () => void;
}> = (props) => (
	<div class="flex items-center justify-between border-b border-clens bg-surface-raised px-4 py-2 text-sm text-[var(--clens-danger)]">
		<span class="flex items-center gap-2">
			<span class="instrument-led bg-[var(--clens-danger)]" aria-hidden="true" />
			{props.message}
		</span>
		<button
			type="button"
			onClick={props.onDismiss}
			class="instrument-microcaps ml-4 text-[10px] text-muted transition hover:text-secondary"
		>
			Dismiss
		</button>
	</div>
);

// ── Loading skeleton ────────────────────────────────────────────────

export const LoadingSkeleton: Component<{
	readonly label?: string;
}> = (props) => (
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<Spinner size="md" />
			<span class="instrument-microcaps text-[11px] text-muted">{props.label ?? "Loading…"}</span>
		</div>
	</div>
);

// ── Skeleton block (shimmer placeholder) ─────────────────────────────

export const SkeletonBlock: Component<{ readonly class?: string }> = (props) => (
	<div class={`relative overflow-hidden rounded-none bg-surface-muted ${props.class ?? ""}`}>
		<div class="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
	</div>
);

// ── Page shell ──────────────────────────────────────────────────────

export const PageShell: Component<{
	readonly children: JSX.Element;
}> = (props) => (
	<div class="flex h-[calc(100vh-var(--app-header-height))] flex-col">
		<Show when={globalError()}>
			{(err) => <ErrorBanner message={err().message} onDismiss={clearError} />}
		</Show>
		{props.children}
	</div>
);
