import type { RouteSectionProps } from "@solidjs/router";
import { useNavigate, useLocation } from "@solidjs/router";
import { createEffect, ErrorBoundary, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { ErrorFallback } from "./components/ErrorFallback";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { initSSE } from "./lib/events";
import { toggleHelp, setKeyboardNavigate } from "./lib/keyboard";
import { preferences } from "./lib/settings";
import { theme, toggleTheme, initThemeListener } from "./lib/theme";

// ── Icons ───────────────────────────────────────────────────────────

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

const GearIcon: Component = () => (
	<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
		<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
		<circle cx="12" cy="12" r="3" />
	</svg>
);

const LogoIcon: Component = () => (
	<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
		<circle cx="11" cy="11" r="7" class="stroke-brand-500" />
		<path d="M16.5 16.5 21 21" class="stroke-brand-500" stroke-linecap="round" />
		<path d="M8.5 9.5l-1.5 1.5 1.5 1.5" class="stroke-brand-400" stroke-linecap="round" stroke-linejoin="round" />
		<path d="M13.5 9.5l1.5 1.5-1.5 1.5" class="stroke-brand-400" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
);

// ── Navigation items ────────────────────────────────────────────────

type NavItem = {
	readonly label: string;
	readonly path: string;
	readonly matchPrefix: string;
};

const NAV_ITEMS: readonly NavItem[] = [
	{ label: "Sessions", path: "/?view=sessions", matchPrefix: "/session" },
	{ label: "Work Units", path: "/?view=work_units", matchPrefix: "/work-unit" },
] as const;

const isNavActive = (item: NavItem, pathname: string, search: string): boolean => {
	if (item.label === "Sessions") {
		return (pathname === "/" && !search.includes("view=work_units")) || pathname.startsWith("/session");
	}
	if (item.label === "Work Units") {
		return (pathname === "/" && search.includes("view=work_units")) || pathname.startsWith("/work-unit");
	}
	return pathname.startsWith(item.matchPrefix);
};

// ── Font size mapping ────────────────────────────────────────────────

const FONT_SIZE_MAP: Readonly<Record<string, string>> = {
	sm: "13px",
	base: "14px",
	lg: "15px",
} as const;

// ── App ─────────────────────────────────────────────────────────────

export const App: Component<RouteSectionProps> = (props) => {
	const navigate = useNavigate();
	const location = useLocation();
	setKeyboardNavigate(navigate);
	let disconnectSSE: (() => void) | undefined;
	let removeThemeListener: (() => void) | undefined;

	createEffect(() => {
		document.documentElement.style.fontSize = FONT_SIZE_MAP[preferences().fontSize] ?? "13px";
	});

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
			<header class="sticky top-0 z-40 flex items-center justify-between border-b border-clens bg-surface px-4 py-1.5 shadow-sm">
				{/* Left: Logo + Nav */}
				<div class="flex items-center gap-4">
					<button
						onClick={() => navigate("/")}
						class="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition hover:opacity-80"
						title="Home"
					>
						<LogoIcon />
						<span class="text-sm font-semibold tracking-tight">cLens</span>
					</button>

					<nav class="flex items-center gap-0.5">
						<For each={NAV_ITEMS}>
							{(item) => (
								<button
									onClick={() => navigate(item.path)}
									class="rounded-md px-2.5 py-1 text-xs font-medium transition"
									classList={{
										"text-primary bg-surface-muted": isNavActive(item, location.pathname, location.search),
										"text-muted hover:text-secondary hover:bg-surface-hover": !isNavActive(item, location.pathname, location.search),
									}}
								>
									{item.label}
								</button>
							)}
						</For>
					</nav>
				</div>

				{/* Right: Actions */}
				<div class="flex items-center gap-1">
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
						onClick={() => navigate("/settings")}
						class="rounded-md p-1.5 transition"
						classList={{
							"text-primary bg-surface-muted": location.pathname === "/settings",
							"text-muted hover:bg-surface-hover hover:text-secondary": location.pathname !== "/settings",
						}}
						title="Settings"
					>
						<GearIcon />
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
