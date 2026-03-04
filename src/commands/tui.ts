// --- Barrel re-exports for backward compatibility ---

// State types, constants, and state machine
export type { ViewType, DetailTab, TuiState } from "./tui-state";
export {
	DETAIL_TABS,
	CONTENT_SCROLL_TABS,
	createInitialState,
	nextTimelineFilter,
	getVisibleTabs,
	nextTab,
	prevTab,
	filterFilesByAgent,
	getEditsFileList,
	handleKey,
} from "./tui-state";

// Tab content formatters
export type { CollapsedEntry } from "./tui-tabs";
export {
	formatOverviewTab,
	formatCommsTab,
	collapseConsecutive,
	formatTimelineEntry,
	formatCollapsedEntry,
	formatSwimLaneEntry,
	formatCollapsedSwimLaneEntry,
	formatTimelineTab,
	formatBacktracksTab,
	formatReasoningTab,
	formatDriftTab,
	formatGraphTab,
	formatDecisionDetail,
	formatDecisionsTabFull,
} from "./tui-tabs";

// Row formatters and renderers
export {
	formatSessionRow,
	formatAgentRow,
	formatAgentDetail,
	render,
} from "./tui-renderers";

// Re-exports from tui-formatters (existing, preserved for test imports)
export {
	colorizeTimelineType,
	formatDecisionsSection,
	formatGitDiffSection,
} from "./tui-formatters";

// --- Key parsing (stays here -- thin, I/O-adjacent) ---

import { ansi } from "./tui-formatters";
import { createInitialState as _createInitialState, handleKey as _handleKey } from "./tui-state";
import { render as _render } from "./tui-renderers";

export const parseKey = (data: Buffer): string | undefined => {
	const str = data.toString();
	if (str === "\x1b" || str === "\x1b\x1b") return "escape";
	if (str === "\r" || str === "\n") return "enter";
	if (str === "\x7f" || str === "\b") return "backspace";
	if (str === "\t") return "tab";
	if (str === "\x1b[Z") return "shift_tab";
	if (str === "q") return "q";
	if (str === "f") return "f";
	if (str === "a") return "a";
	if (str === "g") return "g";
	if (str === "\x1b[A") return "up";
	if (str === "\x1b[B") return "down";
	if (str === "\x1b[C") return "right";
	if (str === "\x1b[D") return "left";
	return undefined;
};

// --- Main interactive loop (I/O entry point) ---
// This function is the sole I/O boundary for the TUI.
// All rendering and state transition logic is pure and testable in their respective modules.

export const startTui = (projectDir: string): void => {
	const initialState = _createInitialState(projectDir);

	if (initialState.sessions.length === 0) {
		process.stdout.write("No sessions found. Run some Claude Code sessions first.\n");
		return;
	}

	process.stdin.setRawMode(true);
	process.stdout.write(ansi.enterAltScreen + ansi.hideCursor);

	// MUTATION EXCEPTION: The interactive event loop requires mutable state to track
	// the current TUI state across async stdin data events. The state transitions
	// themselves (handleKey) are pure -- only the binding of new state to `state.current`
	// is mutable. This is an inherent requirement of event-driven terminal I/O.
	const state = { current: initialState };
	// MUTATION EXCEPTION: The `running` flag is an I/O boundary signal that breaks
	// the async stdin stream loop on cleanup. It cannot be folded into the pure state
	// because it controls the imperative I/O loop lifecycle, not the TUI view state.
	let running = true;

	const draw = () => {
		const rows = process.stdout.rows ?? 24;
		const cols = process.stdout.columns ?? 80;
		const output = _render(state.current, rows, cols);
		process.stdout.write(ansi.clearScreen + output);
	};

	const cleanup = () => {
		running = false;
		process.stdout.write(ansi.showCursor + ansi.leaveAltScreen);
		process.stdin.setRawMode(false);
	};

	process.on("SIGINT", cleanup);
	draw();

	// Use Bun.stdin.stream() instead of process.stdin.on("data") --
	// the Node.js EventEmitter API on stdin does not fire in Bun.
	// LOOP EXCEPTION: The `for await...of` over Bun.stdin.stream() is the only way
	// to consume an async ReadableStream in Bun. There is no FP-friendly alternative
	// for async stream iteration at the I/O boundary. All logic inside is dispatch-only.
	(async () => {
		for await (const chunk of Bun.stdin.stream()) {
			if (!running) break;
			const key = parseKey(Buffer.from(chunk));
			if (!key) continue;

			const result = _handleKey(state.current, key);
			if (result === "quit") {
				cleanup();
				return;
			}
			state.current = result;
			draw();
		}
	})();
};
