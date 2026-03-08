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

// ── Active panel focus ──────────────────────────────────────────────

type PanelFocus = "conversation" | "diff";
const [panelFocus, setPanelFocus] = createSignal<PanelFocus>("conversation");
const togglePanelFocus = () =>
	setPanelFocus((f) => (f === "conversation" ? "diff" : "conversation"));

// ── Shortcut definitions (for help overlay display) ─────────────────

const SHORTCUTS: readonly {
	readonly key: string;
	readonly label: string;
	readonly context: string;
}[] = [
	{ key: "?", label: "Show keyboard shortcuts", context: "Global" },
	{ key: "Esc", label: "Close overlay / Go back", context: "Global" },
	{ key: "j", label: "Next entry", context: "Session View" },
	{ key: "k", label: "Previous entry", context: "Session View" },
	{ key: "Enter", label: "Open session / Drill into agent", context: "Navigation" },
	{ key: "[", label: "Focus conversation panel", context: "Session View" },
	{ key: "]", label: "Focus diff panel", context: "Session View" },
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

		// Panel focus switching
		if (e.key === "[" && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			setPanelFocus("conversation");
			return;
		}
		if (e.key === "]" && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			setPanelFocus("diff");
			return;
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
	panelFocus,
	setPanelFocus,
	togglePanelFocus,
	SHORTCUTS,
};
export type { KeyBinding, KeyboardContext, PanelFocus };
