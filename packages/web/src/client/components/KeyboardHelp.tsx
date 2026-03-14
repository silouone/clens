import { createMemo, For, onCleanup, Show, type Component } from "solid-js";
import { Keyboard } from "lucide-solid";
import { showHelp, setShowHelp, activeShortcuts, GLOBAL_SHORTCUTS } from "../lib/keyboard";

// ── Group shortcuts by context ──────────────────────────────────────

type GroupedShortcuts = readonly { readonly context: string; readonly entries: readonly typeof GLOBAL_SHORTCUTS[number][] }[];

const groupByContext = (
	shortcuts: readonly typeof GLOBAL_SHORTCUTS[number][],
): GroupedShortcuts =>
	Array.from(
		shortcuts.reduce((map, s) => {
			const existing = map.get(s.context) ?? [];
			return new Map(map).set(s.context, [...existing, s]);
		}, new Map<string, readonly typeof GLOBAL_SHORTCUTS[number][]>()),
	).map(([context, entries]) => ({ context, entries }));

// ── Component ───────────────────────────────────────────────────────

export const KeyboardHelp: Component = () => {
	let closeButtonRef: HTMLButtonElement | undefined;
	let overlayRef: HTMLDivElement | undefined;
	let previouslyFocused: Element | null = null;

	const allShortcuts = createMemo(() => [...GLOBAL_SHORTCUTS, ...activeShortcuts()]);
	const grouped = createMemo(() => groupByContext(allShortcuts()));

	// ── Focus trap ──────────────────────────────────────────────

	const handleFocusTrap = (e: KeyboardEvent) => {
		if (e.key !== "Tab" || !overlayRef) return;

		const focusable = overlayRef.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		);
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	// Focus close button when shown changes
	const handleDialogMount = () => {
		previouslyFocused = document.activeElement;
		requestAnimationFrame(() => closeButtonRef?.focus());

		const trapHandler = (e: KeyboardEvent) => handleFocusTrap(e);
		document.addEventListener("keydown", trapHandler);
		onCleanup(() => {
			document.removeEventListener("keydown", trapHandler);
			if (previouslyFocused instanceof HTMLElement) {
				previouslyFocused.focus();
			}
		});
	};

	return (
		<Show when={showHelp()}>
			{(() => {
				handleDialogMount();
				return (
					<div
						ref={overlayRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby="keyboard-help-title"
						class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setShowHelp(false)}
					>
						<div
							class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
							onClick={(e) => e.stopPropagation()}
						>
							<div class="flex items-center justify-between">
								<h2
									id="keyboard-help-title"
									class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
								>
									<Keyboard class="h-5 w-5" /> Keyboard Shortcuts
								</h2>
								<button
									ref={closeButtonRef}
									onClick={() => setShowHelp(false)}
									class="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
								>
									Esc
								</button>
							</div>
							<div class="mt-4 space-y-4">
								<For each={grouped()}>
									{(group) => (
										<div>
											<h3 class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
												{group.context}
											</h3>
											<div class="space-y-0.5">
												<For each={group.entries}>
													{(shortcut) => (
														<div class="flex items-center justify-between py-1.5">
															<span class="text-sm text-gray-700 dark:text-gray-300">{shortcut.label}</span>
															<kbd class="rounded border border-gray-300 bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
																{shortcut.key}
															</kbd>
														</div>
													)}
												</For>
											</div>
										</div>
									)}
								</For>
							</div>
						</div>
					</div>
				);
			})()}
		</Show>
	);
};
