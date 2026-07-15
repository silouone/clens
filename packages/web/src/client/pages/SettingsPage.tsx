import { type Component, createSignal, onCleanup, Show } from "solid-js";
import {
	DEFAULT_SUBSCRIPTION_PLAN,
	PLAN_MONTHLY_USD,
	planFromLegacyPricing,
	type SubscriptionPlan,
} from "../../shared/types";
import { PageShell } from "../components/PageShell";
import { SettingRow } from "../components/settings/SettingRow";
import { SettingsSection } from "../components/settings/SettingsSection";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Spinner } from "../components/ui/Spinner";
import { Toggle } from "../components/ui/Toggle";
import type { FontSize, TimestampFormat } from "../lib/settings";
import {
	preferences,
	projectConfig,
	resetPreferences,
	saveProjectConfig,
	setPreference,
} from "../lib/settings";
import { setTheme } from "../lib/theme";

// ── Theme mode (3-way: light / dark / system) ───────────────────────

type ThemeMode = "light" | "dark" | "system";

const THEME_OPTIONS = [
	{ label: "Light", value: "light" as ThemeMode },
	{ label: "Dark", value: "dark" as ThemeMode },
	{ label: "System", value: "system" as ThemeMode },
] as const;

const FONT_SIZE_OPTIONS = [
	{ label: "Small", value: "sm" as FontSize },
	{ label: "Base", value: "base" as FontSize },
	{ label: "Large", value: "lg" as FontSize },
] as const;

const TIMESTAMP_OPTIONS = [
	{ label: "Relative", value: "relative" as TimestampFormat },
	{ label: "Absolute", value: "absolute" as TimestampFormat },
] as const;

const LIST_LIMIT_OPTIONS = [
	{ label: "20", value: "20" },
	{ label: "50", value: "50" },
	{ label: "100", value: "100" },
] as const;

const PAGE_SIZE_OPTIONS = [
	{ label: "25", value: "25" },
	{ label: "50", value: "50" },
	{ label: "100", value: "100" },
] as const;

const PLAN_OPTIONS = [
	{ label: "Pro", value: "pro" as SubscriptionPlan },
	{ label: "Max 5×", value: "max5x" as SubscriptionPlan },
	{ label: "Max 20×", value: "max20x" as SubscriptionPlan },
	{ label: "API", value: "api" as SubscriptionPlan },
] as const;

/** Human-readable monthly rate for the plan-selector row description. */
const planRateLabel = (plan: SubscriptionPlan): string =>
	plan === "api"
		? "Pay-as-you-go — paid equals API-equivalent value"
		: `Flat $${PLAN_MONTHLY_USD[plan]}/mo subscription`;

// ── Helpers ──────────────────────────────────────────────────────────

const getThemeMode = (): ThemeMode => {
	const stored = localStorage.getItem("clens-theme");
	if (stored === "light" || stored === "dark") return stored;
	return "system";
};

const getStorageSize = (): string => {
	const size = new Blob([JSON.stringify(localStorage)]).size;
	return size < 1024 ? `~${size} B` : `~${Math.round(size / 1024)} KB`;
};

// ── Page component ───────────────────────────────────────────────────

export const SettingsPage: Component = () => {
	const [themeMode, setThemeMode] = createSignal<ThemeMode>(getThemeMode());
	const [configSaved, setConfigSaved] = createSignal(false);
	const [savedTimer, setSavedTimer] = createSignal<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	onCleanup(() => {
		const timer = savedTimer();
		if (timer) clearTimeout(timer);
	});

	const handleThemeChange = (mode: ThemeMode): void => {
		setThemeMode(mode);
		if (mode === "system") {
			localStorage.removeItem("clens-theme");
			const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
			setTheme(systemTheme);
		} else {
			setTheme(mode);
		}
	};

	const handleConfigSave = async (patch: Record<string, unknown>): Promise<void> => {
		const current = projectConfig();
		if (!current) return;
		await saveProjectConfig({ ...current, ...patch });
		setConfigSaved(true);
		const prev = savedTimer();
		if (prev) clearTimeout(prev);
		setSavedTimer(setTimeout(() => setConfigSaved(false), 2000));
	};

	return (
		<PageShell>
			<div class="flex-1 overflow-y-auto scrollbar-hidden">
				<div class="mx-auto w-full max-w-4xl px-6 py-8 lg:px-8">
					<h1 class="instrument-microcaps text-[13px] tracking-[0.14em] text-primary">Settings</h1>
					<div class="instrument-ruler mt-1.5 mb-8 w-40" />

					<div class="space-y-8">
						{/* ── Section 1: Appearance ─────────────────────────── */}
						<SettingsSection title="Appearance">
							<SettingRow
								label="Theme"
								description="Choose light, dark, or follow system preference"
							>
								<SegmentedControl
									options={THEME_OPTIONS}
									value={themeMode()}
									onChange={handleThemeChange}
								/>
							</SettingRow>
							<SettingRow label="Font size" description="Adjust text size across the interface">
								<SegmentedControl
									options={FONT_SIZE_OPTIONS}
									value={preferences().fontSize}
									onChange={(v) => setPreference("fontSize", v)}
								/>
							</SettingRow>
							<SettingRow label="Timestamps" description="Show relative (2m ago) or absolute times">
								<SegmentedControl
									options={TIMESTAMP_OPTIONS}
									value={preferences().showTimestamps}
									onChange={(v) => setPreference("showTimestamps", v)}
								/>
							</SettingRow>
						</SettingsSection>

						{/* ── Section 2: Display ────────────────────────────── */}
						<SettingsSection title="Display">
							<SettingRow label="Session list page size" description="Number of sessions per page">
								<SegmentedControl
									options={LIST_LIMIT_OPTIONS}
									value={String(preferences().sessionListLimit)}
									onChange={(v) => setPreference("sessionListLimit", Number(v))}
								/>
							</SettingRow>
							<SettingRow
								label="Conversation page size"
								description="Messages per page in conversation view"
							>
								<SegmentedControl
									options={PAGE_SIZE_OPTIONS}
									value={String(preferences().conversationPageSize)}
									onChange={(v) => setPreference("conversationPageSize", Number(v))}
								/>
							</SettingRow>
							<SettingRow label="Sidebar width" description="Default sidebar width percentage">
								<div class="flex items-center gap-3">
									<input
										type="range"
										min="15"
										max="40"
										step="1"
										value={preferences().sidebarWidth}
										onInput={(e) => setPreference("sidebarWidth", Number(e.currentTarget.value))}
										class="w-36 cursor-pointer accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
									/>
									<span class="instrument-microcaps tabular-nums w-10 text-right text-[11px] text-secondary">
										{preferences().sidebarWidth}%
									</span>
								</div>
							</SettingRow>
							<SettingRow label="Auto-distill" description="Automatically distill sessions on view">
								<Toggle
									checked={preferences().autoDistill}
									onChange={(v) => setPreference("autoDistill", v)}
								/>
							</SettingRow>
						</SettingsSection>

						{/* ── Section 3: Capture & Cost ─────────────────────── */}
						<SettingsSection title="Capture & Cost">
							<Show
								when={!projectConfig.loading}
								fallback={
									<div class="flex items-center gap-2 py-6">
										<Spinner size="sm" />
										<span class="instrument-microcaps text-[10px] text-muted">
											Loading project config…
										</span>
									</div>
								}
							>
								<Show
									when={projectConfig()}
									fallback={
										<div class="flex items-center gap-2 py-6">
											<span class="instrument-led bg-[var(--clens-danger)]" />
											<span class="text-xs text-muted">Unable to load project configuration.</span>
										</div>
									}
								>
									{(config) => (
										<>
											<SettingRow
												label="Capture enabled"
												description="Enable or disable hook event capture"
											>
												<div class="flex items-center gap-3">
													<Show when={configSaved()}>
														<span class="instrument-microcaps flex items-center gap-1.5 text-[10px] text-[var(--clens-success)] animate-fade-in">
															<span class="instrument-led instrument-led--live bg-[var(--clens-success)]" />
															Saved
														</span>
													</Show>
													<Toggle
														checked={config().capture}
														onChange={(v) => handleConfigSave({ capture: v })}
													/>
												</div>
											</SettingRow>
											{(() => {
												const currentPlan = (): SubscriptionPlan =>
													config().plan ??
													(config().pricing
														? planFromLegacyPricing(config().pricing)
														: DEFAULT_SUBSCRIPTION_PLAN);
												return (
													<SettingRow
														label="Subscription plan"
														description={`Drives PAID vs VALUE vs ROI — ${planRateLabel(currentPlan())}`}
													>
														<SegmentedControl
															options={PLAN_OPTIONS}
															value={currentPlan()}
															onChange={(v) => handleConfigSave({ plan: v })}
														/>
													</SettingRow>
												);
											})()}
										</>
									)}
								</Show>
							</Show>
						</SettingsSection>

						{/* ── Section 4: Server Info ─────────────────────────── */}
						<SettingsSection title="Server Info">
							<SettingRow label="Server port">
								<span class="inline-flex items-center rounded-none border border-clens bg-surface-inset px-2 py-0.5 font-mono text-sm text-secondary tabular-nums">
									{window.location.port || "80"}
								</span>
							</SettingRow>
							<SettingRow label="Origin">
								<span
									class="inline-flex max-w-[300px] items-center truncate rounded-none border border-clens bg-surface-inset px-2 py-0.5 font-mono text-sm text-secondary"
									title={window.location.origin}
								>
									{window.location.origin}
								</span>
							</SettingRow>
						</SettingsSection>

						{/* ── Section 5: Data Management ────────────────────── */}
						<SettingsSection title="Data Management">
							<SettingRow
								label="Local storage usage"
								description="Approximate size of stored preferences"
							>
								<span class="inline-flex items-center rounded-none border border-clens bg-surface-inset px-2 py-0.5 font-mono text-sm text-secondary tabular-nums">
									{getStorageSize()}
								</span>
							</SettingRow>
							<SettingRow
								label="Reset preferences"
								description="Restore all settings to their defaults"
							>
								<Button
									variant="secondary"
									size="sm"
									class="text-[var(--clens-danger)] transition-colors hover:border-[var(--clens-danger)]/40 hover:bg-surface-hover"
									onClick={() => {
										resetPreferences();
										setThemeMode("system");
									}}
								>
									Reset All
								</Button>
							</SettingRow>
						</SettingsSection>
					</div>

					{/* Bottom breathing room */}
					<div class="h-8" />
				</div>
			</div>
		</PageShell>
	);
};
