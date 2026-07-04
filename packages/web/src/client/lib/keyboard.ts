import { createSignal, onCleanup, onMount } from "solid-js";

// ── Types ───────────────────────────────────────────────────────────

type KeyBinding = {
	readonly key: string;
	readonly description: string;
	readonly handler: () => void;
};

type KeyboardContext = "global" | "session-list" | "session-view";

type ShortcutEntry = {
	readonly key: string;
	readonly label: string;
	readonly context: string;
	readonly active: boolean;
};

// ── Help overlay state ──────────────────────────────────────────────

const [showHelp, setShowHelp] = createSignal(false);
const toggleHelp = () => setShowHelp((v) => !v);

// ── Router navigation callback (set by App shell) ──────────────────

const [navigateFn, setNavigateFn] = createSignal<((path: string) => void) | undefined>(undefined);

/** Called by App.tsx to wire the SolidJS router's navigate into keyboard shortcuts. */
const setKeyboardNavigate = (fn: (path: string) => void): void => {
	setNavigateFn(() => fn);
};

// ── Reactive shortcut registry ──────────────────────────────────────

const [activeShortcuts, setActiveShortcuts] = createSignal<readonly ShortcutEntry[]>([]);

// Global shortcuts always present
const GLOBAL_SHORTCUTS: readonly ShortcutEntry[] = [
	{ key: "?", label: "Show keyboard shortcuts", context: "Global", active: true },
	{ key: ",", label: "Open settings", context: "Global", active: true },
	{ key: "Esc", label: "Close overlay / Go back", context: "Global", active: true },
];

const registerShortcuts = (entries: readonly ShortcutEntry[]): (() => void) => {
	setActiveShortcuts((prev) => [...prev, ...entries]);
	return () => {
		setActiveShortcuts((prev) => prev.filter((e) => !entries.includes(e)));
	};
};

// ── Keyboard handler hook ───────────────────────────────────────────

/**
 * Register keyboard handlers for a component.
 * Handlers are only active while the component is mounted.
 * Ignores keystrokes in input/textarea/contentEditable elements.
 * Registers shortcut descriptions into the reactive registry for KeyboardHelp.
 */
const useKeyboard = (bindings: () => readonly KeyBinding[], context = "Navigation"): void => {
	const handler = (e: KeyboardEvent): void => {
		// Skip if user is typing in an input
		const target = e.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
			return;
		}

		// Help toggle (always active)
		if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			toggleHelp();
			return;
		}

		// Settings shortcut (always active)
		if (e.key === "," && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			const nav = navigateFn();
			if (nav) nav("/settings");
			return;
		}

		// Escape closes help overlay first
		if (e.key === "Escape") {
			if (showHelp()) {
				e.preventDefault();
				setShowHelp(false);
				return;
			}
		}

		// Dispatch to component-specific bindings
		const match = bindings().find((b) => b.key === e.key);
		if (match) {
			e.preventDefault();
			match.handler();
		}
	};

	onMount(() => {
		document.addEventListener("keydown", handler);

		// Register shortcuts into the reactive registry
		const entries: readonly ShortcutEntry[] = bindings().map((b) => ({
			key: b.key,
			label: b.description,
			context,
			active: true,
		}));
		const unregister = registerShortcuts(entries);
		onCleanup(unregister);
	});

	onCleanup(() => {
		document.removeEventListener("keydown", handler);
	});
};

export {
	useKeyboard,
	showHelp,
	setShowHelp,
	toggleHelp,
	activeShortcuts,
	GLOBAL_SHORTCUTS,
	setKeyboardNavigate,
};
export type { KeyBinding, KeyboardContext, ShortcutEntry };
