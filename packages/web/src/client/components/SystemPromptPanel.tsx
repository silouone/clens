import { createSignal, Show, type Component } from "solid-js";
import { Clipboard, Check } from "lucide-solid";

// ── Types ────────────────────────────────────────────────────────────

type SystemPromptPanelProps = {
	readonly prompt: string | undefined;
};

// ── Component ────────────────────────────────────────────────────────

const COPIED_FEEDBACK_MS = 1500;

export const SystemPromptPanel: Component<SystemPromptPanelProps> = (props) => {
	const [copied, setCopied] = createSignal(false);

	const handleCopy = () => {
		const text = props.prompt;
		if (!text) return;
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
		});
	};

	return (
		<div class="flex flex-col h-full">
			<div class="flex items-center justify-between px-4 py-2 border-b border-clens">
				<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
					System Prompt
				</h3>
				<Show when={props.prompt}>
					<button
						onClick={handleCopy}
						class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Copy to clipboard"
					>
						<Show when={copied()} fallback={<Clipboard class="h-3.5 w-3.5" />}>
							<Check class="h-3.5 w-3.5" />
						</Show>
						<span>{copied() ? "Copied!" : "Copy"}</span>
					</button>
				</Show>
			</div>
			<Show
				when={props.prompt}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-400">
						No system prompt available
					</div>
				}
			>
				{(text) => (
					<div class="flex-1 overflow-y-auto p-4">
						<pre class="font-mono text-xs text-gray-700 whitespace-pre-wrap break-words leading-relaxed dark:text-gray-300">
							{text()}
						</pre>
					</div>
				)}
			</Show>
		</div>
	);
};
