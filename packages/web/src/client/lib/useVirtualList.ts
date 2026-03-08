import { createMemo, createSignal, type Accessor } from "solid-js";

// ── Types ────────────────────────────────────────────────────────────

type VirtualItem<T> = {
	readonly item: T;
	readonly index: number;
	readonly offsetTop: number;
};

type VirtualListResult<T> = {
	/** Items currently visible in the viewport + overscan */
	readonly visibleItems: Accessor<readonly VirtualItem<T>[]>;
	/** Total estimated height of all items */
	readonly totalHeight: Accessor<number>;
	/** Scroll handler to attach to the container */
	readonly onScroll: (e: Event) => void;
	/** Whether virtual scrolling is active */
	readonly isVirtual: Accessor<boolean>;
};

// ── Constants ────────────────────────────────────────────────────────

const VIRTUAL_THRESHOLD = 500;
const OVERSCAN = 10;

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Lightweight virtual list for SolidJS.
 * Only activates when item count exceeds VIRTUAL_THRESHOLD.
 */
const useVirtualList = <T>(
	items: Accessor<readonly T[]>,
	estimatedItemHeight: number,
	containerHeight: Accessor<number>,
): VirtualListResult<T> => {
	const [scrollTop, setScrollTop] = createSignal(0);

	const isVirtual = createMemo(() => items().length > VIRTUAL_THRESHOLD);

	const totalHeight = createMemo(() =>
		items().length * estimatedItemHeight,
	);

	const visibleItems = createMemo((): readonly VirtualItem<T>[] => {
		const allItems = items();
		if (!isVirtual()) {
			return allItems.map((item, index) => ({
				item,
				index,
				offsetTop: index * estimatedItemHeight,
			}));
		}

		const top = scrollTop();
		const height = containerHeight();
		const startIdx = Math.max(0, Math.floor(top / estimatedItemHeight) - OVERSCAN);
		const endIdx = Math.min(
			allItems.length,
			Math.ceil((top + height) / estimatedItemHeight) + OVERSCAN,
		);

		return allItems.slice(startIdx, endIdx).map((item, i) => ({
			item,
			index: startIdx + i,
			offsetTop: (startIdx + i) * estimatedItemHeight,
		}));
	});

	const onScroll = (e: Event) => {
		const target = e.currentTarget as HTMLElement;
		setScrollTop(target.scrollTop);
	};

	return { visibleItems, totalHeight, onScroll, isVirtual };
};

export { useVirtualList, VIRTUAL_THRESHOLD };
export type { VirtualItem, VirtualListResult };
