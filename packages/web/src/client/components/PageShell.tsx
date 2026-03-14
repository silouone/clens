import { Show, type Component, type JSX } from "solid-js";
import { globalError, clearError } from "../lib/stores";

// ── Error banner ────────────────────────────────────────────────────

export const ErrorBanner: Component<{
	readonly message: string;
	readonly onDismiss: () => void;
}> = (props) => (
	<div class="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
		<span>{props.message}</span>
		<button onClick={props.onDismiss} class="ml-4 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300">
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
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-700" />
			<span class="text-sm text-gray-500">{props.label ?? "Loading..."}</span>
		</div>
	</div>
);

// ── Page shell ──────────────────────────────────────────────────────

export const PageShell: Component<{
	readonly children: JSX.Element;
}> = (props) => (
	<div class="flex h-[calc(100vh-37px)] flex-col">
		<Show when={globalError()}>
			{(err) => (
				<ErrorBanner message={err().message} onDismiss={clearError} />
			)}
		</Show>
		{props.children}
	</div>
);
