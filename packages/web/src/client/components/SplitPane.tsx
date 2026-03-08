import {
	createSignal,
	createEffect,
	onCleanup,
	type Component,
	type JSX,
} from "solid-js";

// ── Constants ────────────────────────────────────────────────────────

const STORAGE_KEY = "clens-split-ratio";
const MIN_WIDTH_PX = 300;
const HANDLE_WIDTH_PX = 4;
const RESIZE_STEP = 0.01;
const DEFAULT_RATIO = 0.5;

// ── LocalStorage helpers ─────────────────────────────────────────────

const loadRatio = (fallback: number): number => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === null) return fallback;
		const parsed = Number.parseFloat(stored);
		return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
	} catch {
		return fallback;
	}
};

const saveRatio = (ratio: number): void => {
	try {
		localStorage.setItem(STORAGE_KEY, String(ratio));
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
	const initialRatio = loadRatio(props.defaultRatio ?? DEFAULT_RATIO);
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
			saveRatio(r);
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
				class="relative overflow-auto transition-[width,height] duration-150"
				style={leftStyle()}
			>
				{props.left}
				<button
					onClick={toggleCollapseLeft}
					class="absolute left-1 top-1 z-10 rounded bg-gray-200/80 px-1.5 py-0.5 text-xs text-gray-500 opacity-0 transition-opacity duration-150 hover:bg-gray-300 hover:text-gray-700 group-hover:opacity-100 dark:bg-gray-800/80 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
					classList={{ "opacity-100": collapsed() === "left" }}
					title={collapsed() === "left" ? "Expand pane" : "Collapse pane"}
					aria-label={collapsed() === "left" ? "Expand pane" : "Collapse pane"}
				>
					{collapsed() === "left" ? (isVertical() ? "\u25BC" : "\u25B6") : (isVertical() ? "\u25B2" : "\u25C0")}
				</button>
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
				<div
					class="rounded-full bg-gray-600 transition-colors duration-150 group-hover:bg-blue-400"
					classList={{
						"w-8 h-1": isVertical(),
						"h-8 w-1": !isVertical(),
					}}
				/>
			</div>

			{/* Second pane (right or bottom) */}
			<div
				class="relative overflow-auto transition-[width,height] duration-150"
				style={rightStyle()}
			>
				{props.right}
				<button
					onClick={toggleCollapseRight}
					class="absolute right-1 top-1 z-10 rounded bg-gray-200/80 px-1.5 py-0.5 text-xs text-gray-500 opacity-0 transition-opacity duration-150 hover:bg-gray-300 hover:text-gray-700 group-hover:opacity-100 dark:bg-gray-800/80 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
					classList={{ "opacity-100": collapsed() === "right" }}
					title={collapsed() === "right" ? "Expand pane" : "Collapse pane"}
					aria-label={collapsed() === "right" ? "Expand pane" : "Collapse pane"}
				>
					{collapsed() === "right" ? (isVertical() ? "\u25B2" : "\u25C0") : (isVertical() ? "\u25BC" : "\u25B6")}
				</button>
			</div>
		</div>
	);
};
