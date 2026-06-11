import { createMemo, For, onCleanup, Show, type Component } from "solid-js";
import { Keyboard } from "lucide-solid";
import { KbdShortcut } from "./ui/KbdShortcut";
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
							class="w-full max-w-md rounded-none border border-clens bg-surface-raised p-6"
							onClick={(e) => e.stopPropagation()}
						>
							<div class="flex items-center justify-between border-b border-clens pb-3">
								<h2
									id="keyboard-help-title"
									class="instrument-microcaps flex items-center gap-2 text-[12px] text-primary"
								>
									<Keyboard class="h-4 w-4" /> Keyboard Shortcuts
								</h2>
								<button
									ref={closeButtonRef}
									onClick={() => setShowHelp(false)}
									class="rounded-none border border-clens px-1.5 py-0.5 font-mono text-[10px] text-muted transition hover:bg-surface-hover hover:text-secondary"
								>
									Esc
								</button>
							</div>
							<div class="mt-4 space-y-4">
								<For each={grouped()}>
									{(group) => (
										<div>
											<h3 class="instrument-microcaps mb-1 text-[10px] text-muted">
												{group.context}
											</h3>
											<div class="divide-y divide-clens">
												<For each={group.entries}>
													{(shortcut) => (
														<div class="flex items-center justify-between py-1.5">
															<span class="text-sm text-secondary">{shortcut.label}</span>
															<kbd class="rounded-none border border-clens bg-surface-muted px-2 py-0.5 font-mono text-xs tabular-nums text-secondary">
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
