import type { RouteSectionProps } from "@solidjs/router";
import { ErrorBoundary, onCleanup, onMount, Show, type Component } from "solid-js";
import { ErrorFallback } from "./components/ErrorFallback";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { initSSE } from "./lib/events";
import { toggleHelp } from "./lib/keyboard";
import { theme, toggleTheme, initThemeListener } from "./lib/theme";

// ── Theme toggle icon ───────────────────────────────────────────────

const SunIcon: Component = () => (
	<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
		<circle cx="12" cy="12" r="5" />
		<path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.73 12.73l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
	</svg>
);

const MoonIcon: Component = () => (
	<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
		<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
	</svg>
);

// ── Logo icon ────────────────────────────────────────────────────────

const LogoIcon: Component = () => (
	<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
		<circle cx="11" cy="11" r="7" class="stroke-brand-500" />
		<path d="M16.5 16.5 21 21" class="stroke-brand-500" stroke-linecap="round" />
		<path d="M8.5 9.5l-1.5 1.5 1.5 1.5" class="stroke-brand-400" stroke-linecap="round" stroke-linejoin="round" />
		<path d="M13.5 9.5l1.5 1.5-1.5 1.5" class="stroke-brand-400" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
);

// ── App ─────────────────────────────────────────────────────────────

export const App: Component<RouteSectionProps> = (props) => {
	let disconnectSSE: (() => void) | undefined;
	let removeThemeListener: (() => void) | undefined;

	onMount(() => {
		disconnectSSE = initSSE();
		removeThemeListener = initThemeListener();
	});

	onCleanup(() => {
		disconnectSSE?.();
		removeThemeListener?.();
	});

	return (
		<div class="min-h-screen bg-surface text-primary">
			<header class="flex items-center justify-between border-b border-clens px-4 py-1.5 shadow-sm">
				<div class="flex items-center gap-1.5">
					<LogoIcon />
					<h1 class="text-sm font-semibold tracking-tight">cLens</h1>
				</div>
				<div class="flex items-center gap-2">
					<button
						onClick={toggleTheme}
						class="rounded-md p-1.5 text-muted transition hover:bg-surface-hover hover:text-secondary"
						title={`Switch to ${theme() === "dark" ? "light" : "dark"} mode`}
					>
						<Show when={theme() === "dark"} fallback={<MoonIcon />}>
							<SunIcon />
						</Show>
					</button>
					<button
						onClick={() => toggleHelp()}
						class="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:text-secondary"
						title="Keyboard shortcuts"
					>
						<kbd class="font-mono">?</kbd>
					</button>
				</div>
			</header>
			<ErrorBoundary
					fallback={(err, reset) => (
						<main class="flex-1">
							<ErrorFallback error={err} reset={reset} variant="full" />
							<div class="mt-2 text-center">
								<a
									href="/"
									class="text-sm text-brand-500 underline transition-colors duration-150 hover:text-brand-400"
								>
									Go Home
								</a>
							</div>
						</main>
					)}
				>
					<main class="animate-page-fade">{props.children}</main>
				</ErrorBoundary>
			<KeyboardHelp />
		</div>
	);
};
