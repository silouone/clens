import { createSignal, onCleanup, onMount } from "solid-js";

// ── Types ───────────────────────────────────────────────────────────

type KeyBinding = {
	readonly key: string;
	readonly description: string;
	readonly handler: () => void;
};

type KeyboardContext = "global" | "session-list" | "session-view";

// ── Help overlay state ──────────────────────────────────────────────

const [showHelp, setShowHelp] = createSignal(false);
const toggleHelp = () => setShowHelp((v) => !v);

// ── Shortcut definitions (for help overlay display) ─────────────────

const SHORTCUTS: readonly {
	readonly key: string;
	readonly label: string;
	readonly context: string;
}[] = [
	{ key: "?", label: "Show keyboard shortcuts", context: "Global" },
	{ key: "Esc", label: "Close overlay / Go back", context: "Global" },
	{ key: "1", label: "Overview panel", context: "Session Detail" },
	{ key: "2-9", label: "Select agent by index", context: "Session Detail" },
	{ key: "j", label: "Next agent / entry", context: "Session Detail" },
	{ key: "k", label: "Previous agent / entry", context: "Session Detail" },
	{ key: "Enter", label: "Open session / Drill into agent", context: "Navigation" },
];

// ── Keyboard handler hook ───────────────────────────────────────────

/**
 * Register keyboard handlers for a component.
 * Handlers are only active while the component is mounted.
 * Ignores keystrokes in input/textarea/contentEditable elements.
 */
const useKeyboard = (bindings: () => readonly KeyBinding[]): void => {
	const handler = (e: KeyboardEvent): void => {
		// Skip if user is typing in an input
		const target = e.target as HTMLElement;
		if (
			target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.isContentEditable
		) {
			return;
		}

		// Help toggle (always active)
		if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			toggleHelp();
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
	SHORTCUTS,
};
export type { KeyBinding, KeyboardContext };
