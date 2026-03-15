import {
	createSignal,
	createEffect,
	onCleanup,
	Show,
	type Component,
	type JSX,
} from "solid-js";
import { ChevronDown, ChevronUp, ChevronRight, ChevronLeft } from "lucide-solid";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_STORAGE_KEY = "clens-split-ratio";
const MIN_WIDTH_PX = 300;
const HANDLE_WIDTH_PX = 4;
const RESIZE_STEP = 0.01;
const DEFAULT_RATIO = 0.5;

// ── LocalStorage helpers ─────────────────────────────────────────────

const loadRatio = (key: string, fallback: number): number => {
	try {
		const stored = localStorage.getItem(key);
		if (stored === null) return fallback;
		const parsed = Number.parseFloat(stored);
		return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
	} catch {
		return fallback;
	}
};

const saveRatio = (key: string, ratio: number): void => {
	try {
		localStorage.setItem(key, String(ratio));
	} catch {
		// Storage full or unavailable — silently ignore
	}
};

// ── Types ────────────────────────────────────────────────────────────

type CollapseState = "none" | "left" | "right";

type SplitPaneProps = {
	readonly left: JSX.Element;
	readonly right: JSX.Element;
	readonly defaultRatio?: number;
	readonly direction?: "horizontal" | "vertical";
	readonly id?: string;
};

// ── Component ────────────────────────────────────────────────────────

// ── Responsive direction hook ───────────────────────────────────────

const BREAKPOINT = "(min-width: 1024px)";

const createResponsiveDirection = (
	directionProp: () => "horizontal" | "vertical" | undefined,
): (() => "horizontal" | "vertical") => {
	const mql = window.matchMedia(BREAKPOINT);
	const [isWide, setIsWide] = createSignal(mql.matches);

	const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
	mql.addEventListener("change", handler);
	onCleanup(() => mql.removeEventListener("change", handler));

	return () => directionProp() ?? (isWide() ? "horizontal" : "vertical");
};

export const SplitPane: Component<SplitPaneProps> = (props) => {
	const storageKey = props.id ? `clens-split-${props.id}` : DEFAULT_STORAGE_KEY;
	const initialRatio = loadRatio(storageKey, props.defaultRatio ?? DEFAULT_RATIO);
	const [ratio, setRatio] = createSignal(initialRatio);
	const [dragging, setDragging] = createSignal(false);
	const [collapsed, setCollapsed] = createSignal<CollapseState>("none");
	const direction = createResponsiveDirection(() => props.direction);
	const isVertical = () => direction() === "vertical";

	let containerRef: HTMLDivElement | undefined;

	// Persist ratio changes
	createEffect(() => {
		const r = ratio();
		if (collapsed() === "none") {
			saveRatio(storageKey, r);
		}
	});

	// ── Clamp ratio to respect min widths ────────────────────────────

	const clampRatio = (r: number): number => {
		if (!containerRef) return r;
		const totalSize = (isVertical() ? containerRef.offsetHeight : containerRef.offsetWidth) - HANDLE_WIDTH_PX;
		if (totalSize <= 0) return r;
		const minRatio = MIN_WIDTH_PX / totalSize;
		const maxRatio = 1 - minRatio;
		return Math.max(minRatio, Math.min(maxRatio, r));
	};

	// ── Drag handlers ────────────────────────────────────────────────

	const onMouseMove = (e: MouseEvent) => {
		if (!containerRef) return;
		const rect = containerRef.getBoundingClientRect();
		const pos = isVertical() ? e.clientY - rect.top : e.clientX - rect.left;
		const totalSize = (isVertical() ? rect.height : rect.width) - HANDLE_WIDTH_PX;
		if (totalSize <= 0) return;
		const newRatio = clampRatio(pos / totalSize);
		setRatio(newRatio);
	};

	const onMouseUp = () => {
		setDragging(false);
		document.removeEventListener("mousemove", onMouseMove);
		document.removeEventListener("mouseup", onMouseUp);
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	};

	const onMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		setCollapsed("none");
		setDragging(true);
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
		document.body.style.cursor = isVertical() ? "row-resize" : "col-resize";
		document.body.style.userSelect = "none";
	};

	// ── Keyboard resize ──────────────────────────────────────────────

	const onKeyDown = (e: KeyboardEvent) => {
		const shrinkKey = isVertical() ? "ArrowUp" : "ArrowLeft";
		const growKey = isVertical() ? "ArrowDown" : "ArrowRight";
		if (e.key === shrinkKey) {
			e.preventDefault();
			setCollapsed("none");
			setRatio((r) => clampRatio(r - RESIZE_STEP));
		} else if (e.key === growKey) {
			e.preventDefault();
			setCollapsed("none");
			setRatio((r) => clampRatio(r + RESIZE_STEP));
		}
	};

	// ── Collapse toggles ─────────────────────────────────────────────

	const toggleCollapseLeft = () => {
		setCollapsed((c) => (c === "left" ? "none" : "left"));
	};

	const toggleCollapseRight = () => {
		setCollapsed((c) => (c === "right" ? "none" : "right"));
	};

	// ── Computed styles ──────────────────────────────────────────────

	const leftStyle = (): JSX.CSSProperties => {
		const c = collapsed();
		const v = isVertical();
		const sizeProp = v ? "height" : "width";
		const minProp = v ? "min-height" : "min-width";
		if (c === "left") return { [sizeProp]: "0px", [minProp]: "0px", overflow: "hidden" };
		if (c === "right") return { [sizeProp]: "100%", [minProp]: "0px" };
		return { [sizeProp]: `${ratio() * 100}%`, [minProp]: `${MIN_WIDTH_PX}px` };
	};

	const rightStyle = (): JSX.CSSProperties => {
		const c = collapsed();
		const v = isVertical();
		const sizeProp = v ? "height" : "width";
		const minProp = v ? "min-height" : "min-width";
		if (c === "right") return { [sizeProp]: "0px", [minProp]: "0px", overflow: "hidden" };
		if (c === "left") return { [sizeProp]: "100%", [minProp]: "0px" };
		return { [sizeProp]: `${(1 - ratio()) * 100}%`, [minProp]: `${MIN_WIDTH_PX}px` };
	};

	// Cleanup on unmount
	onCleanup(() => {
		document.removeEventListener("mousemove", onMouseMove);
		document.removeEventListener("mouseup", onMouseUp);
	});

	return (
		<div
			ref={containerRef}
			class="flex h-full w-full transition-[flex-direction] duration-150"
			classList={{ "flex-col": isVertical() }}
		>
			{/* First pane (left or top) */}
			<div
				class="relative overflow-auto"
				classList={{ "transition-[width,height] duration-150": !dragging() }}
				style={leftStyle()}
			>
				{props.left}
			</div>

			{/* Drag handle */}
			<div
				class="group relative flex flex-shrink-0 items-center justify-center transition-colors duration-150 hover:bg-blue-600/30"
				classList={{
					"bg-blue-600/40": dragging(),
					"cursor-row-resize": isVertical(),
					"cursor-col-resize": !isVertical(),
				}}
				style={isVertical()
					? { height: `${HANDLE_WIDTH_PX}px` }
					: { width: `${HANDLE_WIDTH_PX}px` }
				}
				onMouseDown={onMouseDown}
				onKeyDown={onKeyDown}
				tabIndex={0}
				role="separator"
				aria-orientation={isVertical() ? "horizontal" : "vertical"}
				aria-valuenow={Math.round(ratio() * 100)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label="Resize panes"
			>
				{/* Collapse / expand affordance */}
				<Show when={collapsed() === "left"}>
					<button
						onClick={(e) => { e.stopPropagation(); toggleCollapseLeft(); }}
						class="absolute z-10 flex items-center justify-center rounded bg-surface-muted/90 p-0.5 text-muted shadow-sm transition hover:bg-surface-hover hover:text-secondary"
						classList={{
							"-left-3 top-1/2 -translate-y-1/2": !isVertical(),
							"-top-3 left-1/2 -translate-x-1/2": isVertical(),
						}}
						title="Expand left pane"
						aria-label="Expand left pane"
					>
						{isVertical() ? <ChevronDown class="h-3 w-3" /> : <ChevronRight class="h-3 w-3" />}
					</button>
				</Show>
				<Show when={collapsed() === "right"}>
					<button
						onClick={(e) => { e.stopPropagation(); toggleCollapseRight(); }}
						class="absolute z-10 flex items-center justify-center rounded bg-surface-muted/90 p-0.5 text-muted shadow-sm transition hover:bg-surface-hover hover:text-secondary"
						classList={{
							"-right-3 top-1/2 -translate-y-1/2": !isVertical(),
							"-bottom-3 left-1/2 -translate-x-1/2": isVertical(),
						}}
						title="Expand right pane"
						aria-label="Expand right pane"
					>
						{isVertical() ? <ChevronUp class="h-3 w-3" /> : <ChevronLeft class="h-3 w-3" />}
					</button>
				</Show>
				<Show when={collapsed() === "none"}>
					{/* Drag indicator dots */}
					<div class="flex items-center justify-center gap-0.5" classList={{ "flex-col": !isVertical() }}>
						<div class="h-1 w-1 rounded-full bg-gray-400" />
						<div class="h-1 w-1 rounded-full bg-gray-400" />
						<div class="h-1 w-1 rounded-full bg-gray-400" />
						<div class="h-1 w-1 rounded-full bg-gray-400" />
					</div>
					{/* Collapse buttons on hover */}
					<button
						onClick={(e) => { e.stopPropagation(); toggleCollapseLeft(); }}
						class="absolute z-10 rounded bg-surface-muted/80 p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-hover hover:text-secondary"
						classList={{
							"left-0 top-1/2 -translate-y-1/2 -translate-x-full": !isVertical(),
							"top-0 left-1/2 -translate-x-1/2 -translate-y-full": isVertical(),
						}}
						title="Collapse left pane"
						aria-label="Collapse left pane"
					>
						{isVertical() ? <ChevronUp class="h-3 w-3" /> : <ChevronLeft class="h-3 w-3" />}
					</button>
					<button
						onClick={(e) => { e.stopPropagation(); toggleCollapseRight(); }}
						class="absolute z-10 rounded bg-surface-muted/80 p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-hover hover:text-secondary"
						classList={{
							"right-0 top-1/2 -translate-y-1/2 translate-x-full": !isVertical(),
							"bottom-0 left-1/2 -translate-x-1/2 translate-y-full": isVertical(),
						}}
						title="Collapse right pane"
						aria-label="Collapse right pane"
					>
						{isVertical() ? <ChevronDown class="h-3 w-3" /> : <ChevronRight class="h-3 w-3" />}
					</button>
				</Show>
			</div>

			{/* Second pane (right or bottom) */}
			<div
				class="relative overflow-auto"
				classList={{ "transition-[width,height] duration-150": !dragging() }}
				style={rightStyle()}
			>
				{props.right}
			</div>
		</div>
	);
};
