import { createSignal } from "solid-js";

// ── Types ───────────────────────────────────────────────────────────

type Theme = "light" | "dark";

const STORAGE_KEY = "clens-theme";

// ── System preference detection ─────────────────────────────────────

const getSystemTheme = (): Theme =>
	window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const getStoredTheme = (): Theme | undefined => {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === "light" || stored === "dark" ? stored : undefined;
};

// ── Signal ──────────────────────────────────────────────────────────

const initialTheme = getStoredTheme() ?? getSystemTheme();

const [theme, setThemeSignal] = createSignal<Theme>(initialTheme);

const applyTheme = (t: Theme): void => {
	const root = document.documentElement;
	if (t === "dark") {
		root.classList.add("dark");
	} else {
		root.classList.remove("dark");
	}
};

// Apply on load
applyTheme(initialTheme);

const setTheme = (t: Theme): void => {
	setThemeSignal(t);
	localStorage.setItem(STORAGE_KEY, t);
	applyTheme(t);
};

const toggleTheme = (): void => {
	setTheme(theme() === "dark" ? "light" : "dark");
};

// ── System preference listener ──────────────────────────────────────

const initThemeListener = (): (() => void) => {
	const mql = window.matchMedia("(prefers-color-scheme: dark)");
	const handler = (e: MediaQueryListEvent): void => {
		// Only follow system if user hasn't set a preference
		if (!getStoredTheme()) {
			setTheme(e.matches ? "dark" : "light");
		}
	};
	mql.addEventListener("change", handler);
	return () => mql.removeEventListener("change", handler);
};

export { theme, setTheme, toggleTheme, initThemeListener };
export type { Theme };
