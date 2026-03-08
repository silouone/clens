import { For, Show, type Component } from "solid-js";
import { showHelp, setShowHelp, SHORTCUTS } from "../lib/keyboard";

export const KeyboardHelp: Component = () => (
	<Show when={showHelp()}>
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={() => setShowHelp(false)}
		>
			<div
				class="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl dark:border-gray-600 dark:bg-gray-800"
				onClick={(e) => e.stopPropagation()}
			>
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-semibold text-gray-100">Keyboard Shortcuts</h2>
					<button
						onClick={() => setShowHelp(false)}
						class="rounded p-1 text-gray-400 transition hover:bg-gray-800 hover:text-gray-200 dark:hover:bg-gray-700"
					>
						Esc
					</button>
				</div>
				<div class="mt-4 space-y-1">
					<For each={SHORTCUTS}>
						{(shortcut) => (
							<div class="flex items-center justify-between py-1.5">
								<span class="text-sm text-gray-300">{shortcut.label}</span>
								<div class="flex items-center gap-2">
									<span class="text-xs text-gray-500">{shortcut.context}</span>
									<kbd class="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 font-mono text-xs text-gray-300 dark:border-gray-500 dark:bg-gray-700">
										{shortcut.key}
									</kbd>
								</div>
							</div>
						)}
					</For>
				</div>
			</div>
		</div>
	</Show>
);
