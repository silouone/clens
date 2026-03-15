import type { RouteSectionProps } from "@solidjs/router";
import { useNavigate, useLocation } from "@solidjs/router";
import { createEffect, ErrorBoundary, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { Database, Calendar, Activity, Clock } from "lucide-solid";
import { ErrorFallback } from "./components/ErrorFallback";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { StatItem } from "./components/ui/StatItem";
import { initSSE } from "./lib/events";
import { formatDuration } from "./lib/format";
import { toggleHelp, setKeyboardNavigate } from "./lib/keyboard";
import { preferences } from "./lib/settings";
import { sessionList } from "./lib/stores";
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
	<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
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

	// ── KPI derivations ──────────────────────────────────────────────
	const sessions = () => sessionList() ?? [];
	const todayCount = () => {
		const now = new Date();
		return sessions().filter((s) => {
			const d = new Date(s.start_time);
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
		}).length;
	};
	const totalEvents = () => sessions().reduce((sum, s) => sum + s.event_count, 0);
	const avgDuration = () => {
		const s = sessions();
		return s.length === 0 ? 0 : Math.round(s.reduce((sum, x) => sum + x.duration_ms, 0) / s.length);
	};
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
			<header class="sticky top-0 z-40 flex items-center border-b border-clens bg-surface px-4 py-2.5 shadow-sm">
				{/* Logo */}
				<button
					onClick={() => navigate("/")}
					class="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition hover:opacity-80"
					title="Home"
				>
					<LogoIcon />
					<span class="text-base font-semibold tracking-tight">cLens</span>
				</button>

				{/* KPIs (center area) */}
				<Show when={sessionList.state !== "pending"}>
					<div class="ml-6 flex items-center gap-2">
						<StatItem variant="pill" bordered icon={Database} label="Total" value={String(sessions().length)} />
						<StatItem variant="pill" bordered icon={Calendar} label="Today" value={String(todayCount())} />
						<StatItem variant="pill" bordered icon={Activity} label="Events" value={totalEvents().toLocaleString()} />
						<StatItem variant="pill" bordered icon={Clock} label="Avg" value={formatDuration(avgDuration())} />
					</div>
				</Show>

				{/* Right: Nav + Live + separator + Actions */}
				<div class="ml-auto flex items-center gap-1">
					<nav class="flex items-center gap-1">
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

					<div class="flex items-center gap-1 ml-1" title="Live updates via SSE">
						<span class="relative flex h-2 w-2">
							<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
							<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
						</span>
						<span class="text-[10px] text-muted">Live</span>
					</div>

					<div class="mx-2 h-5 w-px bg-clens" />

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
