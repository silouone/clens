import { createResource, createSignal } from "solid-js";
import type { ClensConfig } from "../../shared/types";

// ── Types ───────────────────────────────────────────────────────────

type FontSize = "sm" | "base" | "lg";
type TimestampFormat = "relative" | "absolute";

type ClientPreferences = {
	readonly fontSize: FontSize;
	readonly sidebarWidth: number;
	readonly sessionListLimit: number;
	readonly autoDistill: boolean;
	readonly showTimestamps: TimestampFormat;
	readonly conversationPageSize: number;
};

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_PREFS: ClientPreferences = {
	fontSize: "sm",
	sidebarWidth: 25,
	sessionListLimit: 50,
	autoDistill: true,
	showTimestamps: "relative",
	conversationPageSize: 50,
} as const;

const STORAGE_KEY = "clens-preferences";

const LOG_PREFIX = "[cLens:settings]";

// ── Validation ──────────────────────────────────────────────────────

const VALID_FONT_SIZES: readonly FontSize[] = ["sm", "base", "lg"] as const;
const VALID_TIMESTAMP_FORMATS: readonly TimestampFormat[] = ["relative", "absolute"] as const;
const VALID_LIST_LIMITS: readonly number[] = [20, 50, 100] as const;
const VALID_PAGE_SIZES: readonly number[] = [25, 50, 100] as const;

const isValidFontSize = (v: unknown): v is FontSize =>
	VALID_FONT_SIZES.includes(v as FontSize);

const isValidTimestampFormat = (v: unknown): v is TimestampFormat =>
	VALID_TIMESTAMP_FORMATS.includes(v as TimestampFormat);

const isValidSidebarWidth = (v: unknown): v is number =>
	typeof v === "number" && v >= 15 && v <= 40;

const isValidListLimit = (v: unknown): v is number =>
	VALID_LIST_LIMITS.includes(v as number);

const isValidPageSize = (v: unknown): v is number =>
	VALID_PAGE_SIZES.includes(v as number);

/** Validate and sanitize stored preferences, falling back to defaults for invalid fields. */
const validatePreferences = (raw: Record<string, unknown>): ClientPreferences => ({
	fontSize: isValidFontSize(raw.fontSize) ? raw.fontSize : DEFAULT_PREFS.fontSize,
	sidebarWidth: isValidSidebarWidth(raw.sidebarWidth) ? raw.sidebarWidth : DEFAULT_PREFS.sidebarWidth,
	sessionListLimit: isValidListLimit(raw.sessionListLimit) ? raw.sessionListLimit : DEFAULT_PREFS.sessionListLimit,
	autoDistill: typeof raw.autoDistill === "boolean" ? raw.autoDistill : DEFAULT_PREFS.autoDistill,
	showTimestamps: isValidTimestampFormat(raw.showTimestamps) ? raw.showTimestamps : DEFAULT_PREFS.showTimestamps,
	conversationPageSize: isValidPageSize(raw.conversationPageSize) ? raw.conversationPageSize : DEFAULT_PREFS.conversationPageSize,
});

// ── Storage ─────────────────────────────────────────────────────────

const loadStoredPreferences = (): ClientPreferences => {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (!stored) return DEFAULT_PREFS;
	try {
		const parsed: unknown = JSON.parse(stored);
		if (!parsed || typeof parsed !== "object") return DEFAULT_PREFS;
		return validatePreferences(parsed as Record<string, unknown>);
	} catch {
		console.debug(LOG_PREFIX, "Invalid stored preferences, using defaults");
		return DEFAULT_PREFS;
	}
};

const persistPreferences = (prefs: ClientPreferences): void => {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
};

// ── Reactive signal ─────────────────────────────────────────────────

const [preferences, setPreferencesSignal] = createSignal<ClientPreferences>(
	loadStoredPreferences(),
);

/** Update a single preference key and persist to localStorage. */
const setPreference = <K extends keyof ClientPreferences>(
	key: K,
	value: ClientPreferences[K],
): void => {
	const updated: ClientPreferences = { ...preferences(), [key]: value };
	const validated = validatePreferences(updated);
	setPreferencesSignal(validated);
	persistPreferences(validated);
};

/** Reset all preferences to defaults and clear localStorage. */
const resetPreferences = (): void => {
	setPreferencesSignal(DEFAULT_PREFS);
	localStorage.removeItem(STORAGE_KEY);
};

// ── Auth helper ─────────────────────────────────────────────────────

const getTokenHeader = (): Record<string, string> => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	return token ? { Authorization: `Bearer ${token}` } : {};
};

// ── Config validation ───────────────────────────────────────────────

const VALID_PRICING_TIERS: readonly string[] = ["api", "max", "auto"] as const;

/** Validate and extract a ClensConfig from an unknown API response payload. */
const validateConfig = (raw: unknown): ClensConfig | undefined => {
	if (!raw || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	const capture = typeof obj.capture === "boolean" ? obj.capture : true;
	const pricing = typeof obj.pricing === "string" && VALID_PRICING_TIERS.includes(obj.pricing)
		? (obj.pricing as ClensConfig["pricing"])
		: undefined;
	return { capture, ...(pricing ? { pricing } : {}) };
};

/** Unwrap API response body — handles both `{ data: ... }` and direct payloads. */
const unwrapResponseData = (body: unknown): unknown => {
	if (!body || typeof body !== "object") return undefined;
	const wrapper = body as Record<string, unknown>;
	return "data" in wrapper ? wrapper.data : body;
};

// ── Project config resource ─────────────────────────────────────────

const fetchProjectConfig = async (): Promise<ClensConfig | undefined> => {
	console.debug(LOG_PREFIX, "Fetching project config");
	try {
		const res = await fetch("/api/config", {
			headers: { ...getTokenHeader() },
		});
		if (!res.ok) {
			console.error(LOG_PREFIX, `Config fetch error: HTTP ${res.status}`);
			return undefined;
		}
		const body: unknown = await res.json();
		const data = unwrapResponseData(body);
		const config = validateConfig(data);
		if (!config) return undefined;
		console.debug(LOG_PREFIX, "Project config loaded");
		return config;
	} catch (err) {
		console.error(LOG_PREFIX, "Config fetch failed:", err);
		return undefined;
	}
};

const [projectConfig, { refetch: refetchProjectConfig }] =
	createResource(fetchProjectConfig);

/** Save updated project config via PUT /api/config. */
const saveProjectConfig = async (config: ClensConfig): Promise<ClensConfig | undefined> => {
	console.debug(LOG_PREFIX, "Saving project config");
	try {
		const res = await fetch("/api/config", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				...getTokenHeader(),
			},
			body: JSON.stringify(config),
		});
		if (!res.ok) {
			console.error(LOG_PREFIX, `Config save error: HTTP ${res.status}`);
			return undefined;
		}
		const body: unknown = await res.json();
		const data = unwrapResponseData(body);
		const validated = validateConfig(data);
		if (!validated) return undefined;
		console.debug(LOG_PREFIX, "Project config saved");
		await refetchProjectConfig();
		return validated;
	} catch (err) {
		console.error(LOG_PREFIX, "Config save failed:", err);
		return undefined;
	}
};

// ── Exports ─────────────────────────────────────────────────────────

export {
	preferences,
	setPreference,
	resetPreferences,
	projectConfig,
	saveProjectConfig,
	refetchProjectConfig,
	DEFAULT_PREFS,
};
export type { ClientPreferences, FontSize, TimestampFormat };
