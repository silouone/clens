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
			<div class="max-w-md rounded-none border border-clens bg-surface-raised p-6 text-center">
				<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-none border border-clens bg-surface-inset">
					<AlertTriangle class="h-5 w-5 text-[var(--clens-danger)]" />
				</div>
				<h3 class="instrument-microcaps flex items-center justify-center gap-2 text-[12px] text-[var(--clens-danger)]">
					<span class="instrument-led bg-[var(--clens-danger)]" aria-hidden="true" />
					{variant() === "panel"
						? `${props.componentName ?? "This panel"} encountered an error`
						: "Something went wrong"}
				</h3>
				<p class="mt-2 text-sm text-secondary">
					{props.error.message || "An unexpected error occurred."}
				</p>
				<div class="mt-4 flex items-center justify-center gap-2">
					<button
						onClick={props.reset}
						class="instrument-microcaps rounded-none border border-brand-500 bg-brand-500 px-3 py-1.5 text-[10px] text-[var(--clens-surface)] transition-colors duration-150 hover:bg-brand-600"
					>
						Retry
					</button>
					<button
						onClick={handleCopy}
						class="instrument-microcaps rounded-none border border-clens px-3 py-1.5 text-[10px] text-secondary transition-colors duration-150 hover:bg-surface-hover"
					>
						{copied() ? "Copied!" : "Copy error"}
					</button>
				</div>
			</div>
		</div>
	);
};
