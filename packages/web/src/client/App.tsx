import type { RouteSectionProps } from "@solidjs/router";
import { useNavigate, useLocation } from "@solidjs/router";
import { createEffect, createSignal, ErrorBoundary, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { Database, Calendar, Activity, Clock, DollarSign, BarChart3, Lightbulb, ChevronDown } from "lucide-solid";
import { ErrorFallback } from "./components/ErrorFallback";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { headerStats } from "./lib/analytics-store";
import { initSSE } from "./lib/events";
import { formatCost, formatDuration } from "./lib/format";
import { toggleHelp, setKeyboardNavigate } from "./lib/keyboard";
import { preferences } from "./lib/settings";
import { SHOW_WORK_UNITS } from "./lib/feature-flags";
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
	<img src="/logo.png" alt="cLens" class="h-11 w-11 object-contain" />
);

// ── Navigation items ────────────────────────────────────────────────

type NavItem = {
	readonly label: string;
	readonly path: string;
	readonly matchPrefix: string;
};

const ALL_NAV_ITEMS: readonly NavItem[] = [
	{ label: "Sessions", path: "/?view=sessions", matchPrefix: "/session" },
	{ label: "Work Units", path: "/?view=work_units", matchPrefix: "/work-unit" },
] as const;

// Work Units is feature-flagged off; filter its nav entry out when hidden so the
// feature is unreachable from the header. Entry definition above stays intact.
const NAV_ITEMS: readonly NavItem[] = ALL_NAV_ITEMS.filter(
	(item) => SHOW_WORK_UNITS || item.label !== "Work Units",
);

const isNavActive = (item: NavItem, pathname: string, search: string): boolean => {
	if (item.label === "Sessions") {
		return (pathname === "/" && !search.includes("view=work_units")) || pathname.startsWith("/session");
	}
	if (item.label === "Work Units") {
		return (pathname === "/" && search.includes("view=work_units")) || pathname.startsWith("/work-unit");
	}
	return pathname.startsWith(item.matchPrefix);
};

const isAnalyticsActive = (pathname: string): boolean =>
	pathname === "/usage" || pathname === "/insights";

// ── Font size mapping ────────────────────────────────────────────────

const FONT_SIZE_MAP: Readonly<Record<string, string>> = {
	sm: "13px",
	base: "14px",
	lg: "15px",
} as const;

// ── Analytics Dropdown ───────────────────────────────────────────────

type AnalyticsDropdownProps = {
	readonly active: boolean;
	readonly sessionCount: number;
	readonly todayCount: number;
	readonly totalEvents: number;
	readonly avgDuration: number;
	readonly totalCost: number;
	readonly sessionsWithCost: number;
	readonly loaded: boolean;
	readonly onNavigate: (path: string) => void;
};

const AnalyticsDropdown: Component<AnalyticsDropdownProps> = (props) => {
	const [open, setOpen] = createSignal(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const handleEnter = () => {
		clearTimeout(closeTimer);
		setOpen(true);
	};

	const handleLeave = () => {
		closeTimer = setTimeout(() => setOpen(false), 150);
	};

	onCleanup(() => clearTimeout(closeTimer));

	return (
		<div
			class="relative"
			onMouseEnter={handleEnter}
			onMouseLeave={handleLeave}
		>
			{/* Trigger button */}
			<button
				onClick={() => props.onNavigate("/usage")}
				class="instrument-microcaps flex items-center gap-1 rounded-none border-b-2 px-2.5 py-1 text-[10px] transition"
				classList={{
					"text-primary border-brand-500": props.active,
					"text-muted border-transparent hover:text-secondary": !props.active,
				}}
			>
				Analytics
				<ChevronDown
					class="h-3 w-3 transition-transform duration-200"
					classList={{ "rotate-180": open() }}
				/>
			</button>

			{/* Dropdown panel */}
			<Show when={open()}>
				<div class="absolute right-0 top-full z-50 mt-1.5 w-64 origin-top-right animate-dropdown rounded-none border border-clens bg-surface-raised">
					{/* KPI quick-view */}
					<Show when={props.loaded}>
						<div class="border-b border-clens">
							<div class="grid grid-cols-2 gap-px bg-clens">
								<div class="flex items-center gap-2 bg-surface-raised px-3 py-2.5">
									<Database class="h-3.5 w-3.5 text-muted shrink-0" />
									<div class="min-w-0">
										{/* Source is usage totals.sessions = the analytics-summary (distilled)
										    subset, which can lag the live session list. The list KPI labeled
										    "Analyzed" counts live is_distilled instead, so the two can disagree;
										    name this one "Reported" to make the distinct source explicit and
										    never contradict the list total (NUM-10 / NUM-20).
										    OPEN-DECISION: exact wording ("Reported" vs "In Analytics"). */}
										<div class="instrument-microcaps text-[9px] text-muted leading-none">Reported</div>
										<div class="font-mono text-xs font-semibold text-secondary tabular-nums mt-1">{props.sessionCount}</div>
									</div>
								</div>
								<div class="flex items-center gap-2 bg-surface-raised px-3 py-2.5">
									<Calendar class="h-3.5 w-3.5 text-muted shrink-0" />
									<div class="min-w-0">
										<div class="instrument-microcaps text-[9px] text-muted leading-none">Today</div>
										<div class="font-mono text-xs font-semibold text-secondary tabular-nums mt-1">{props.todayCount}</div>
									</div>
								</div>
								<div class="flex items-center gap-2 bg-surface-raised px-3 py-2.5">
									<Activity class="h-3.5 w-3.5 text-muted shrink-0" />
									<div class="min-w-0">
										<div class="instrument-microcaps text-[9px] text-muted leading-none">Tool Calls</div>
										<div class="font-mono text-xs font-semibold text-secondary tabular-nums mt-1">{props.totalEvents.toLocaleString()}</div>
									</div>
								</div>
								<div class="flex items-center gap-2 bg-surface-raised px-3 py-2.5">
									<Clock class="h-3.5 w-3.5 text-muted shrink-0" />
									<div class="min-w-0">
										{/* Active = working time (idle excluded); aggregate uses stats.duration_ms,
										    per-session views use active_duration_ms — same concept, distinct computation. */}
										<div class="instrument-microcaps text-[9px] text-muted leading-none">Avg Active</div>
										<div class="font-mono text-xs font-semibold text-secondary tabular-nums mt-1">{formatDuration(props.avgDuration)}</div>
									</div>
								</div>
							</div>
							{/* Cost — full-width row */}
							<div class="flex items-center gap-2 px-3 py-2.5 border-t border-clens">
								<DollarSign class="h-3.5 w-3.5 text-muted shrink-0" />
								<div class="min-w-0">
									<div class="instrument-microcaps text-[9px] text-muted leading-none">Total Cost</div>
									{/* LOCKED: never render $0.00. When no session carried a cost
									    (sessions_with_cost === 0) show "-"; otherwise formatCost guards
									    the sub-cent case with "<$0.01" (NUM-21). */}
									<div class="font-mono text-xs font-semibold text-secondary tabular-nums mt-1">
										{props.sessionsWithCost === 0 ? "-" : formatCost(props.totalCost)}
									</div>
								</div>
							</div>
						</div>
					</Show>

					{/* Dashboard links */}
					<div class="p-1.5">
						<button
							onClick={() => { props.onNavigate("/usage"); setOpen(false); }}
							class="flex w-full items-center gap-2.5 rounded-none px-2.5 py-2 text-xs transition hover:bg-surface-hover group"
						>
							<BarChart3 class="h-4 w-4 text-muted group-hover:text-brand-500 transition-colors shrink-0" />
							<div class="text-left">
								<div class="font-medium text-secondary group-hover:text-primary transition-colors">Usage</div>
								<div class="text-[10px] text-muted leading-tight mt-0.5">Cost, tokens, models & trends</div>
							</div>
						</button>
						<button
							onClick={() => { props.onNavigate("/insights"); setOpen(false); }}
							class="flex w-full items-center gap-2.5 rounded-none px-2.5 py-2 text-xs transition hover:bg-surface-hover group"
						>
							<Lightbulb class="h-4 w-4 text-muted group-hover:text-brand-500 transition-colors shrink-0" />
							<div class="text-left">
								<div class="font-medium text-secondary group-hover:text-primary transition-colors">Insights</div>
								<div class="text-[10px] text-muted leading-tight mt-0.5">Backtracks, drift & quality signals</div>
							</div>
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
};

// ── App ─────────────────────────────────────────────────────────────

export const App: Component<RouteSectionProps> = (props) => {
	const navigate = useNavigate();
	const location = useLocation();
	setKeyboardNavigate(navigate);

	// ── KPI derivations (from analytics API — server-aggregated, no limit) ──
	const stats = () => headerStats() ?? { totalSessions: 0, todaySessions: 0, totalEvents: 0, avgDurationMs: 0, totalCostUsd: 0, sessionsWithCost: 0 };

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
			<header class="sticky top-0 z-40 flex items-center border-b border-clens bg-surface px-4 py-2.5">
				{/* Logo + wordmark */}
				<button
					onClick={() => navigate("/")}
					class="flex items-center gap-2 rounded-none px-1 py-0.5 transition hover:opacity-80"
					title="Home"
				>
					<LogoIcon />
					<span class="hidden items-baseline gap-1.5 sm:flex">
						<span class="font-mono text-sm font-semibold tracking-tight text-primary">cLens</span>
						<span class="instrument-microcaps text-[9px] text-muted">instrument</span>
					</span>
				</button>

				{/* Right: Nav + Live + separator + Actions */}
				<div class="ml-auto flex items-center gap-1">
					<nav class="flex items-center gap-1">
						<For each={NAV_ITEMS}>
							{(item) => (
								<button
									onClick={() => navigate(item.path)}
									class="instrument-microcaps rounded-none px-2.5 py-1 text-[10px] transition border-b-2"
									classList={{
										"text-primary border-brand-500": isNavActive(item, location.pathname, location.search),
										"text-muted border-transparent hover:text-secondary": !isNavActive(item, location.pathname, location.search),
									}}
								>
									{item.label}
								</button>
							)}
						</For>

						<AnalyticsDropdown
							active={isAnalyticsActive(location.pathname)}
							sessionCount={stats().totalSessions}
							todayCount={stats().todaySessions}
							totalEvents={stats().totalEvents}
							avgDuration={stats().avgDurationMs}
							totalCost={stats().totalCostUsd}
							sessionsWithCost={stats().sessionsWithCost}
							loaded={headerStats.state !== "pending"}
							onNavigate={navigate}
						/>
					</nav>

					<div class="flex items-center gap-1.5 ml-1" title="Live updates via SSE">
						<span class="relative flex">
							<span class="absolute inline-flex h-full w-full animate-ping bg-brand-500 opacity-60 instrument-led" />
							<span class="instrument-led instrument-led--live relative inline-block bg-brand-500" />
						</span>
						<span class="instrument-microcaps text-[9px] text-brand-500">Live</span>
					</div>

					<div class="mx-2 h-5 w-px bg-clens" />

					<button
						onClick={toggleTheme}
						class="rounded-none p-1.5 text-muted transition hover:bg-surface-hover hover:text-secondary"
						title={`Switch to ${theme() === "dark" ? "light" : "dark"} mode`}
					>
						<Show when={theme() === "dark"} fallback={<MoonIcon />}>
							<SunIcon />
						</Show>
					</button>
					<button
						onClick={() => navigate("/settings")}
						class="rounded-none p-1.5 transition"
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
						class="rounded-none px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:text-secondary"
						title="Keyboard shortcuts"
					>
						<kbd class="font-mono">?</kbd>
					</button>
				</div>
			</header>
			{/* Tick-mark ruler motif — oscilloscope graticule under the header */}
			<div class="instrument-ruler" aria-hidden="true" />
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
