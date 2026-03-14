import { createSignal, type Component } from "solid-js";
import { AlertTriangle } from "lucide-solid";

type ErrorFallbackProps = {
	readonly error: Error;
	readonly reset: () => void;
	readonly componentName?: string;
	/** "full" for top-level, "panel" for per-component */
	readonly variant?: "full" | "panel";
};

const copyErrorToClipboard = async (error: Error): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(`${error.name}: ${error.message}\n${error.stack ?? ""}`);
		return true;
	} catch {
		return false;
	}
};

/**
 * Reusable error fallback UI for ErrorBoundary components.
 * Shows error message with retry + copy error buttons.
 */
export const ErrorFallback: Component<ErrorFallbackProps> = (props) => {
	const [copied, setCopied] = createSignal(false);
	const variant = () => props.variant ?? "full";

	console.error(
		`[cLens] Error in ${props.componentName ?? "component"}:`,
		props.error,
	);

	const handleCopy = async () => {
		const ok = await copyErrorToClipboard(props.error);
		if (ok) {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<div
			class="flex items-center justify-center p-6"
			classList={{
				"h-full": variant() === "full",
				"min-h-[120px]": variant() === "panel",
			}}
		>
			<div class="max-w-md rounded-lg border border-red-300 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
				<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
					<AlertTriangle class="h-5 w-5 text-red-600 dark:text-red-400" />
				</div>
				<h3 class="text-base font-semibold text-red-800 dark:text-red-200">
					{variant() === "panel"
						? `${props.componentName ?? "This panel"} encountered an error`
						: "Something went wrong"}
				</h3>
				<p class="mt-1.5 text-sm text-red-600/80 dark:text-red-400/80">
					{props.error.message || "An unexpected error occurred."}
				</p>
				<div class="mt-4 flex items-center justify-center gap-2">
					<button
						onClick={props.reset}
						class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
					>
						Retry
					</button>
					<button
						onClick={handleCopy}
						class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors duration-150 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40"
					>
						{copied() ? "Copied!" : "Copy error"}
					</button>
				</div>
			</div>
		</div>
	);
};
