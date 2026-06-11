// Pure local-day helpers for analytics drill-down (B22). Kept out of analytics-store
// so they can be unit-tested without triggering the store's module-level Solid
// resources. The session list consumes the `?date=YYYY-MM-DD` param the usage/insights
// charts emit and filters to sessions whose start_time falls on that LOCAL calendar
// day — matching how analytics buckets days (see analytics-summary.localDayKey / B18).

/** Local calendar day ("YYYY-MM-DD") for an epoch-ms timestamp. */
export const localDayKey = (ms: number): string => {
	const d = new Date(ms);
	const year = d.getFullYear();
	const month = `${d.getMonth() + 1}`.padStart(2, "0");
	const day = `${d.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
};

/** True when a session start time (epoch ms) falls on the given local day "YYYY-MM-DD". */
export const matchesLocalDay = (startTimeMs: number, dateStr: string): boolean =>
	localDayKey(startTimeMs) === dateStr;

/** True when `dateStr` is a well-formed "YYYY-MM-DD" day key. */
export const isValidDayKey = (dateStr: string | undefined): dateStr is string =>
	dateStr !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
