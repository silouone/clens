import { createSignal, Show, type Component, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ArrowLeft, Menu, X } from "lucide-solid";
import { preferences } from "../../lib/settings";

type DetailPageLayoutProps = {
	/** Label for the back button (e.g. "Sessions", "Work Units") */
	readonly backLabel: string;
	/** URL to navigate back to */
	readonly backHref: string;
	/** ID string shown next to back button */
	readonly id: string;
	/** Optional badge shown next to the ID (e.g. project badge in global mode) */
	readonly badge?: JSX.Element;
	/** Header component */
	readonly header: JSX.Element;
	/** Sidebar nav component */
	readonly nav: JSX.Element;
	/** Main content area */
	readonly children: JSX.Element;
};

export const DetailPageLayout: Component<DetailPageLayoutProps> = (props) => {
	const navigate = useNavigate();
	const [sidebarOpen, setSidebarOpen] = createSignal(false);

	return (
		<>
			{/* Back nav bar */}
			<div class="flex items-center gap-2 border-b border-clens px-3 py-1">
				{/* Mobile sidebar toggle */}
				<button
					onClick={() => setSidebarOpen((prev) => !prev)}
					class="rounded-none p-1 text-muted transition hover:bg-surface-hover hover:text-secondary md:hidden"
					aria-label="Toggle sidebar"
				>
					<Show when={sidebarOpen()} fallback={<Menu class="h-4 w-4" />}>
						<X class="h-4 w-4" />
					</Show>
				</button>
				<button
					onClick={() => navigate(props.backHref)}
					class="instrument-microcaps flex items-center gap-1 rounded-none px-2 py-1 text-[10px] text-muted transition hover:bg-surface-hover hover:text-secondary focus:outline-none focus:ring-2 focus:ring-brand-500"
					aria-label={`Back to ${props.backLabel}`}
				>
					<ArrowLeft class="h-3 w-3" />
					{props.backLabel}
				</button>
				<span class="font-mono text-xs tabular-nums text-muted">{props.id}</span>
				{props.badge}
			</div>

			{/* Header */}
			{props.header}

			{/* Body: sidebar nav + content panel */}
			<div class="relative flex flex-1 overflow-hidden">
				{/* Mobile backdrop */}
				<Show when={sidebarOpen()}>
					<div
						class="fixed inset-0 z-20 bg-black/30 md:hidden"
						onClick={() => setSidebarOpen(false)}
					/>
				</Show>

				{/* Left sidebar nav — width driven by sidebarWidth preference (percentage) */}
				<aside
					class="absolute inset-y-0 left-0 z-30 w-[80%] max-w-xs shrink-0 transform transition-transform duration-200 ease-in-out md:relative md:max-w-none md:w-[var(--sidebar-width)] md:translate-x-0"
					classList={{ "-translate-x-full": !sidebarOpen(), "translate-x-0": sidebarOpen() }}
					style={{ "--sidebar-width": `${preferences().sidebarWidth}%` }}
					aria-label="Detail sidebar"
				>
					{props.nav}
				</aside>

				{/* Right content panel */}
				{props.children}
			</div>
		</>
	);
};
